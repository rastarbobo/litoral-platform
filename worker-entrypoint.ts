/**
 * Custom Cloudflare Worker entry — set `wrangler.jsonc` → `"main": "./worker-entrypoint.ts"`.
 *
 * vinext resolves `vinext/server/app-router-entry` in the RSC build; this file wraps it so you
 * can add edge-only behavior (security headers, auth, routing) before the App Router runs.
 *
 * @see https://github.com/vinext/vinext/blob/main/packages/vinext/src/server/app-router-entry.ts
 */
import { AnalyticsQueueMessage } from "./src/lib/scheduler/analytics-queue";
import { ScheduledQueueMessage } from "./src/lib/scheduler/jobs";
import handler from "vinext/server/app-router-entry";
import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
  IMAGE_OPTIMIZATION_PATH,
} from "vinext/server/image-optimization";
import { runStaleLockScanner } from "./src/services/stale-lock-scanner";
import {
  handleSchedulerCron,
  handleSchedulerQueue,
} from "./src/lib/scheduler/worker";
import { CF_CONTEXT_FIELDS } from "./src/utils/cf-context-fields";
import {
  CLIENT_IP_HEADERS_TO_STRIP,
  TRUSTED_CLIENT_IP_HEADER,
} from "./src/utils/trusted-client-ip";

/**
 * Edge-only logic before vinext and `/_vinext/image`.
 * Return a `Response` to short-circuit; return `null` to continue.
 */
async function handleCustomEdge(
  request: Request,
  __env: Env,
  __ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === "/_worker/health") {
    return Response.json({ ok: true });
  }

  const optOutMatch = url.pathname.match(/^\/api\/prospects\/([^\/]+)\/opt-out$/);
  if (request.method === "GET" && optOutMatch) {
    const prospectId = optOutMatch[1];
    if (!__env.OPT_OUT_KV) {
      return Response.json({ error: "KV binding missing" }, { status: 500 });
    }
    const isOptedOut = await __env.OPT_OUT_KV.get(`opt_out:${prospectId}`);
    return Response.json({ optedOut: !!isOptedOut, prospectId });
  }

  if (request.method === "POST" && url.pathname === "/api/webhooks/reply") {
    try {
      const authHeader = request.headers.get("Authorization");
      const expectedToken = __env.REPLY_WEBHOOK_SECRET;
      const isAuthorized =
        expectedToken &&
        authHeader &&
        authHeader.length === `Bearer ${expectedToken}`.length &&
        timingSafeCompare(authHeader, `Bearer ${expectedToken}`);
      if (!isAuthorized) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      const body = await request.json() as { prospectId?: string };
      if (!body.prospectId) {
        return Response.json({ error: "Missing prospectId" }, { status: 400 });
      }
      
      const { restaurantRepo } = await import("./src/db/repositories/restaurant-repository");
      const result = await restaurantRepo.transitionProspectState(body.prospectId, "reply");
      
      if (result.type === "NOT_FOUND") {
        return Response.json({ error: "Prospect not found" }, { status: 404 });
      } else if (result.type === "DATABASE_ERROR") {
        return Response.json({ error: "Internal Server Error", details: result.message }, { status: 500 });
      } else if (result.type === "CONCURRENT_MODIFICATION") {
        return Response.json({ error: "Concurrent modification, please retry" }, { status: 409 });
      } else if (result.type === "NO_OP") {
        return Response.json({ success: true, message: "State is already 5 or higher", result });
      }

      if (__env.N8N_WEBHOOK_REPLY_ALERT_URL) {
        // Trigger the Telegram alert in the background without blocking the response
        __ctx.waitUntil(fetch(__env.N8N_WEBHOOK_REPLY_ALERT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prospectId: body.prospectId }),
        }).catch(err => console.error("Failed to trigger n8n webhook", err)));
      }

      return Response.json({ success: true, result });
    } catch {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
  }

  if (request.method === "POST" && url.pathname === "/api/webhooks/competitor-signup") {
    try {
      const authHeader = request.headers.get("Authorization");
      const expectedToken = __env.COMPETITOR_WEBHOOK_SECRET;
      const isAuthorized =
        expectedToken &&
        authHeader &&
        authHeader.length === `Bearer ${expectedToken}`.length &&
        timingSafeCompare(authHeader, `Bearer ${expectedToken}`);
      
      if (!isAuthorized) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      const body = await request.json() as { competitorId?: string };
      if (!body.competitorId || typeof body.competitorId !== 'string' || body.competitorId.trim() === '') {
        return Response.json({ error: "competitorId must be a non-empty string" }, { status: 400 });
      }

      const { processCompetitorSignup } = await import("./src/lib/scheduler/retargeting-scheduler");
      const processedCount = await processCompetitorSignup(__env as unknown as Record<string, unknown>, body.competitorId);
      
      return Response.json({ success: true, processedCount });
    } catch (error) {
      console.error("Competitor signup webhook error", { error });
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
  }

  if (request.method === "POST" && url.pathname === "/api/webhooks/tracking") {
    try {
      const authHeader = request.headers.get("Authorization");
      const expectedToken = __env.TRACKING_WEBHOOK_SECRET;
      const isAuthorized =
        expectedToken &&
        authHeader &&
        authHeader.length === `Bearer ${expectedToken}`.length &&
        timingSafeCompare(authHeader, `Bearer ${expectedToken}`);
      if (!isAuthorized) {
        return Response.json({ status: "error", message: "Unauthorized" }, { status: 401 });
      }

      const body = await request.json() as { prospectId?: string; eventType?: string; metadata?: Record<string, unknown> };
      if (!body.prospectId || !body.eventType) {
        return Response.json({ status: "fail", data: { message: "Missing required tracking fields" } }, { status: 400 });
      }

      await __env.ANALYTICS_QUEUE.send({
        prospectId: body.prospectId,
        eventType: body.eventType,
        metadata: body.metadata,
      });

      return Response.json({ status: "success", data: { message: "Event enqueued" } });
    } catch {
      return Response.json({ status: "fail", data: { message: "Invalid tracking payload" } }, { status: 400 });
    }
  }

  return null;
}

  const worker = {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const early = await handleCustomEdge(request, env, ctx);
      if (early) return early;

      const url = new URL(request.url);

      if (url.pathname === IMAGE_OPTIMIZATION_PATH) {
        const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
        return handleImageOptimization(
          request,
          {
            fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
            transformImage: async (body, { width, format, quality }) => {
              const result = await env.IMAGES
                .input(body)
                .transform(width > 0 ? { width } : {})
                .output({ format: format as ImageOutputOptions["format"], quality });
              return result.response();
            },
          },
          allowedWidths,
        );
      }

      return handler.fetch(withForwardedCfHeaders(request), env, ctx);
    },

    async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
      const now = new Date(controller.scheduledTime);
      ctx.waitUntil(
        (async () => {
          // Run the general scheduler cron tasks
          await handleSchedulerCron({ env, now });
          // Run the stale lock scanner (Story 6.2)
          try {
            const result = await runStaleLockScanner();
            if (result.reverted > 0) {
              console.warn("Worker scheduled: stale lock scanner reverted", { result });
            }
          } catch (err) {
            console.error("Worker scheduled: stale lock scanner failed", { error: err });
          }
        })()
      );
    },

    async queue(batch: MessageBatch<unknown>, __env: Env, __ctx: ExecutionContext): Promise<void> {
      if (batch.queue === "cloudflare-workers-nextjs-saas-template-analytics") {
        const { handleAnalyticsQueue } = await import("./src/lib/scheduler/analytics-queue");
        await handleAnalyticsQueue(batch as MessageBatch<AnalyticsQueueMessage>);
      } else if (batch.queue === "cloudflare-workers-nextjs-saas-template-competitor-activated") {
        for (const message of batch.messages) {
          try {
            const body = JSON.parse(message.body as string) as { restaurantId?: string };
            if (body.restaurantId) {
              const { processCompetitorSignup } = await import("./src/lib/scheduler/retargeting-scheduler");
              await processCompetitorSignup(__env as unknown as Record<string, unknown>, body.restaurantId);
            }
            message.ack();
          } catch (err) {
            console.error("Competitor activated queue handler error", { error: err, messageId: message.id });
            message.retry();
          }
        }
      } else {
        await handleSchedulerQueue(batch as MessageBatch<ScheduledQueueMessage>);
      }
    },
  } satisfies ExportedHandler<Env, unknown>;

// Only set here (never trusted from the inbound request) to prevent client spoofing.
function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function withForwardedCfHeaders(request: Request): Request {
  const forwarded = new Request(request);
  for (const header of CLIENT_IP_HEADERS_TO_STRIP) {
    forwarded.headers.delete(header);
  }

  for (const { header } of CF_CONTEXT_FIELDS) {
    forwarded.headers.delete(header);
  }

  const trustedClientIp = request.headers.get("cf-connecting-ip");
  if (trustedClientIp) {
    forwarded.headers.set(TRUSTED_CLIENT_IP_HEADER, trustedClientIp);
  }

  const cf = request.cf;
  if (!cf) return forwarded;

  for (const { key, header } of CF_CONTEXT_FIELDS) {
    const value = cf[key];
    if (value !== undefined && value !== null && value !== "") {
      forwarded.headers.set(header, String(value));
    }
  }

  return forwarded;
}

export default worker;
