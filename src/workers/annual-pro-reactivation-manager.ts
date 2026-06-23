/**
 * Annual Pro Reactivation Manager — Story 7.5 (Task 6.2)
 *
 * Cloudflare Worker cron that runs on March 1st at 00:00 UTC.
 * Reactivates hibernated Annual Pro clients for the new season.
 *
 * ADR-001 compliance: Worker cron for simple D1 query + Stripe API call + D1 write.
 */

import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { determineTargetMode } from "@/services/reactivation-engine";
import { restoreR2Access } from "@/services/asset-suspension";
import { tryCatch } from "@/lib/try-catch";
import { OPERATIONAL_MODE } from "@/db/schema";

// ─── Worker Entry Point ──────────────────────────────────

/**
 * Scheduled handler — runs on March 1st at 00:00 UTC.
 */
export async function scheduled(
  _event: ScheduledEvent,
  env: { TELEGRAM_BOT_TOKEN?: string },
  _ctx: ExecutionContext,
): Promise<void> {
  console.info("Annual Pro Reactivation Manager: starting annual reactivation");
  await processAnnualProReactivation(env);
  console.info("Annual Pro Reactivation Manager: reactivation complete");
}

/**
 * HTTP handler — allows manual trigger via POST.
 */
export async function fetch(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { error } = await tryCatch(processAnnualProReactivation({}));

  if (error) {
    console.error("Annual Pro Reactivation Manager: manual trigger failed", {
      error,
    });
    return new Response(
      JSON.stringify({ status: "error", message: "Reactivation failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ status: "success", message: "Reactivation processed" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// ─── Core Logic ──────────────────────────────────────────

interface ReactivationEnv {
  TELEGRAM_BOT_TOKEN?: string;
}

async function processAnnualProReactivation(env: ReactivationEnv): Promise<void> {
  // 1. Find hibernated Annual Pro clients
  const { data: hibernatedClients, error: queryError } =
    await restaurantRepo.getHibernatingAnnualProClients();

  if (queryError) {
    console.error(
      "Annual Pro Reactivation Manager: failed to query clients",
      { error: queryError },
    );
    return;
  }

  if (!hibernatedClients || hibernatedClients.length === 0) {
    console.info(
      "Annual Pro Reactivation Manager: no hibernated Annual Pro clients to reactivate",
    );
    return;
  }

  console.info(
    `Annual Pro Reactivation Manager: reactivating ${hibernatedClients.length} Annual Pro clients`,
  );

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const targetMode = determineTargetMode(currentMonth);

  let successCount = 0;

  for (const restaurant of hibernatedClients) {
    try {
      // 2. Reactivate — transition from hibernate to active
      const result = await restaurantRepo.reactivateFromHibernate(
        restaurant.id,
        targetMode,
      );

      if (result.type === "SUCCESS") {
        // 3. Restore R2 access
        await restoreR2Access(restaurant.id);

        successCount++;

        // 4. Notify owner via Telegram
        if (restaurant.telegramChatId && env.TELEGRAM_BOT_TOKEN) {
          await sendReactivationNotification(
            env.TELEGRAM_BOT_TOKEN,
            restaurant.telegramChatId,
            restaurant.name ?? "Your restaurant",
          );
        }

        console.info(
          `Annual Pro Reactivation Manager: reactivated ${restaurant.name}`,
          { restaurantId: restaurant.id, targetMode },
        );
      } else if (result.type === "NO_OP") {
        console.info(
          "Annual Pro Reactivation Manager: client already reactivated",
          { restaurantId: restaurant.id },
        );
      }
    } catch (err) {
      console.error(
        "Annual Pro Reactivation Manager: failed for restaurant",
        {
          error: err instanceof Error ? err.message : "Unknown",
          restaurantId: restaurant.id,
        },
      );
    }
  }

  console.info(
    `Annual Pro Reactivation Manager: complete — ${successCount}/${hibernatedClients.length} clients reactivated`,
  );
}

// ─── Helpers ─────────────────────────────────────────────

async function sendReactivationNotification(
  botToken: string,
  chatId: string,
  restaurantName: string,
): Promise<void> {
  const message =
    `🌅 **The new season is approaching!**\n\n` +
    `${restaurantName} — Litoral has reactivated your subscription and ` +
    `will begin generating campaigns automatically.\n\n` +
    `All your assets and campaign history are here waiting for you. ` +
    `Welcome back! 🎉`;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "Markdown",
        }),
      },
    );

    if (!response.ok) {
      console.error(
        "Annual Pro Reactivation Manager: Telegram notification failed",
        { chatId, status: response.status },
      );
    }
  } catch (err) {
    console.error(
      "Annual Pro Reactivation Manager: Telegram notification error",
      { error: err instanceof Error ? err.message : "Unknown", chatId },
    );
  }
}