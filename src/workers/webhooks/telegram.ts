/**
 * ADR-001: Strict One-Way Webhook Flow
 * Telegram → CF Worker (/webhooks/telegram) → CF Queue (telegram-updates) → n8n
 * Never expose n8n directly to internet-facing webhooks.
 */

interface TelegramEnv {
  TELEGRAM_UPDATES_QUEUE: { send(message: TelegramUpdate): Promise<void> };
  TELEGRAM_WEBHOOK_SECRET: string; // X-Telegram-Bot-Api-Secret-Token header value
  TELEGRAM_DEDUP_KV?: KVNamespace; // Persistent dedup cache across Worker isolates (Patch 1)
}

// Minimal Telegram update types (enough for dedup + queue enqueue)
interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
}

// ─── Review Response Callback Handling (Story 7.3, Task 3.6) ───

/**
 * Handle review_response callback queries directly in the Worker
 * for fast feedback (avoids round-trip through n8n queue).
 *
 * Callback data format:
 * - review_response:approve:{responseId}
 * - review_response:edit:{responseId}
 * - review_response:skip:{responseId}
 */
// Reserved — may be wired into a future fast-path handler.
// async function handleReviewResponseCallback(
//   callbackData: string,
//   chatId: number,
//   env: { DB?: D1Database; TELEGRAM_BOT_TOKEN?: string },
// ): Promise<boolean> {
//   const match = callbackData.match(/^review_response:(approve|edit|skip):(.+)$/);
//   if (!match) return false;
// 
//   const [, action, responseId] = match;
// 
//   try {
//     if (action === "approve") {
//       await updateReviewResponseStatus(responseId, "approved", env);
//       await sendCallbackConfirmation(chatId, "Response approved! It will be published via the Chrome Extension.", env);
//     } else if (action === "edit") {
//       await sendCallbackConfirmation(
//         chatId,
//         "Please reply with your edited response text. I'll update the response and re-submit it for your review.",
//         env,
//       );
//     } else if (action === "skip") {
//       await updateReviewResponseStatus(responseId, "rejected", env);
//       await sendCallbackConfirmation(chatId, "Response skipped. The review has been logged.", env);
//     }
//     return true;
//   } catch (error) {
//     console.error("Review response callback handling failed", {
//       error: error instanceof Error ? error.message : "Unknown",
//       responseId,
//       action,
//     });
//     return false;
//   }
// }

// eslint-disable-next-line no-unused-vars
async function __updateReviewResponseStatus(
  responseId: string,
  status: string,
  _env: { DB?: D1Database },
): Promise<void> {
  // Prefer repository over raw D1 for abstraction consistency (Story 7.3)
  // The Worker env.DB is still available as fallback, but the repository
  // handles the schema mapping and timestamp logic.
  try {
    const { reviewResponsesRepo } = await import("@/db/repositories/review-responses-repository");
    const result = await reviewResponsesRepo.updateStatus(responseId, status as "approved" | "rejected" | "published" | "drafted");
    if (result.type === "DATABASE_ERROR") {
      throw new Error(result.message);
    }
  } catch (err) {
    // Fallback to raw D1 if repository import fails (edge case in Worker context)
    console.error("ReviewResponsesRepo failed, falling back to raw D1", { error: err instanceof Error ? err.message : "Unknown" });
    if (!_env.DB) {
      throw new Error("No D1 database binding available for review response update");
    }
    const now = new Date().toISOString();
    const approvedAt = status === "approved" ? now : null;
    await _env.DB.prepare(
      `UPDATE review_responses
       SET status = ?1, updated_at = ?2, approved_at = ?3
       WHERE id = ?4`,
    )
      .bind(status, now, approvedAt, responseId)
      .run();
  }
}

// eslint-disable-next-line no-unused-vars
async function __sendCallbackConfirmation(
  chatId: number,
  text: string,
  env: { TELEGRAM_BOT_TOKEN?: string },
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;

  try {
    await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      },
    );
  } catch (err) {
    console.error("Failed to send callback confirmation", { error: err });
  }
}

// In-memory dedup cache (fallback only; KV is preferred for cross-isolate dedup)
const seenUpdateIds = new Set<number>();
const MAX_DEDUP_CACHE = 1000;

/**
 * JSend response wrapper
 */
function jsend(status: "success" | "error" | "fail", data: unknown, statusCode = 200) {
  const body = status === "success" ? { status, data } : status === "error" ? { status, message: data } : { status, data };
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { "Content-Type": "application/json" },
  });
}

// Cloudflare Worker default export — consumed by the runtime.
// eslint-disable-next-line import/no-anonymous-default-export
export default {
  async fetch(request: Request, env: TelegramEnv, __ctx: ExecutionContext): Promise<Response> {
    try {
      // 1. Validate HTTP method
      if (request.method !== "POST") {
        return jsend("error", "Method not allowed", 405);
      }

      // 2. Validate secret token header
      const secretHeader = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (!secretHeader || secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
        console.warn("Telegram webhook: invalid secret token", {
          received: secretHeader ? "[redacted]" : "missing",
        });
        return jsend("error", "Unauthorized", 401);
      }

      // 3. Parse and validate body
      let update: TelegramUpdate;
      try {
        update = (await request.json()) as TelegramUpdate;
      } catch {
        return jsend("error", "Invalid JSON body", 400);
      }

      if (typeof update.update_id !== "number") {
        return jsend("error", "Missing update_id", 400);
      }

      // 4. Deduplicate on update_id using KV (persistent across isolates; Patch 1)
      try {
        const dedupKey = `telegram_dedup_${update.update_id}`;
        if (env.TELEGRAM_DEDUP_KV) {
          const existing = await env.TELEGRAM_DEDUP_KV.get(dedupKey);
          if (existing) {
            console.info("Telegram webhook: duplicate update_id from KV dedup", {
              update_id: update.update_id,
            });
            return jsend("success", "Deduped", 200);
          }
          await env.TELEGRAM_DEDUP_KV.put(dedupKey, "1", { expirationTtl: 86400 });
        }
      } catch (err) {
        console.error("Telegram webhook: KV dedup check failed, using in-memory fallback", {
          error: err instanceof Error ? err.message : "Unknown",
        });
      }

      // 4b. In-memory dedup as fallback
      if (seenUpdateIds.has(update.update_id)) {
        console.info("Telegram webhook: duplicate update_id deduped", {
          update_id: update.update_id,
        });
        return jsend("success", "Deduped", 200);
      }

      // Add to in-memory dedup cache (FIFO eviction)
      seenUpdateIds.add(update.update_id);
      if (seenUpdateIds.size > MAX_DEDUP_CACHE) {
        const first = seenUpdateIds.values().next().value;
        if (typeof first === 'number') {
          seenUpdateIds.delete(first);
        }
      }

      // 5. Enqueue to Cloudflare Queue (fire-and-forget; n8n processes async)
      if (env.TELEGRAM_UPDATES_QUEUE) {
        await env.TELEGRAM_UPDATES_QUEUE.send(update);
        console.info("Telegram webhook: enqueued", {
          update_id: update.update_id,
          has_callback: !!update.callback_query,
          has_message: !!update.message,
        });
      } else {
        console.error("Telegram webhook: TELEGRAM_UPDATES_QUEUE binding missing");
        return jsend("error", "Queue binding unavailable", 500);
      }

      // 6. Return 200 immediately (Telegram requires fast response)
      return jsend("success", "Queued", 200);
    } catch (error) {
      console.error("Telegram webhook: unexpected error", {
        error: error instanceof Error ? error.message : "Unknown",
      });
      return jsend("error", "Internal server error", 500);
    }
  },
};
