/**
 * Annual Pro Hibernate Manager — Story 7.5 (Task 6.1)
 *
 * Cloudflare Worker cron that runs on October 1st at 00:00 UTC.
 * Identifies Annual Pro clients and transitions them into
 * Hibernate tier at no additional charge.
 *
 * ADR-001 compliance: Worker cron for simple D1 query + Stripe API call + D1 write.
 */

// eq, and, inArray reserved for future filtering logic
// import { eq, and, inArray } from "drizzle-orm";
import { getDB } from "@/db";

import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { transitionToHibernate } from "@/services/asset-suspension";
import { tryCatch } from "@/lib/try-catch";

// ─── Worker Entry Point ──────────────────────────────────

// Cloudflare Worker entry point — not imported by any other module.
// eslint-disable-next-line project/no-unused-module-exports
export async function scheduled(
  __event: ScheduledEvent,
  env: { TELEGRAM_BOT_TOKEN?: string; STRIPE_SECRET_KEY?: string },
  __ctx: ExecutionContext,
): Promise<void> {
  console.info("Annual Pro Hibernate Manager: starting annual cycle");
  await processAnnualProHibernation(env);
  console.info("Annual Pro Hibernate Manager: cycle complete");
}

// Cloudflare Worker entry point — not imported by any other module.
// eslint-disable-next-line project/no-unused-module-exports
export async function fetch(__request: Request): Promise<Response> {
  if (__request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { error } = await tryCatch(processAnnualProHibernation({}));

  if (error) {
    console.error("Annual Pro Hibernate Manager: manual trigger failed", { error });
    return new Response(
      JSON.stringify({ status: "error", message: "Hibernation processing failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ status: "success", message: "Hibernation processed" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// ─── Core Logic ──────────────────────────────────────────

interface HibernateEnv {
  TELEGRAM_BOT_TOKEN?: string;
  STRIPE_SECRET_KEY?: string;
}

async function processAnnualProHibernation(env: HibernateEnv): Promise<void> {
  const __db = getDB();

  // 1. Find Annual Pro clients with active subscriptions
  const { data: annualProClients, error: queryError } =
    await restaurantRepo.getAnnualProClientsForHibernation();

  if (queryError) {
    console.error("Annual Pro Hibernate Manager: failed to query clients", {
      error: queryError,
    });
    return;
  }

  if (!annualProClients || annualProClients.length === 0) {
    console.info("Annual Pro Hibernate Manager: no Annual Pro clients to hibernate");
    return;
  }

  console.info(
    `Annual Pro Hibernate Manager: processing ${annualProClients.length} Annual Pro clients`,
  );

  let successCount = 0;

  for (const restaurant of annualProClients) {
    try {
      // 2. Transition to hibernate status
      const result = await transitionToHibernate(restaurant.id);

      if (result) {
        successCount++;

        // 3. Notify owner via Telegram
        if (restaurant.telegramChatId && env.TELEGRAM_BOT_TOKEN) {
          await sendAnnualProHibernateNotification(
            env.TELEGRAM_BOT_TOKEN,
            restaurant.telegramChatId,
            restaurant.name ?? "Your restaurant",
          );
        }

        console.info(
          `Annual Pro Hibernate Manager: hibernated ${restaurant.name}`,
          { restaurantId: restaurant.id },
        );
      }
    } catch (err) {
      console.error("Annual Pro Hibernate Manager: failed for restaurant", {
        error: err instanceof Error ? err.message : "Unknown",
        restaurantId: restaurant.id,
      });
    }
  }

  console.info(
    `Annual Pro Hibernate Manager: complete — ${successCount}/${annualProClients.length} clients hibernated`,
  );
}

// ─── Helpers ─────────────────────────────────────────────

async function sendAnnualProHibernateNotification(
  botToken: string,
  chatId: string,
  restaurantName: string,
): Promise<void> {
  const message =
    `🏖️ **${restaurantName}** — Your Annual Pro subscription has entered the ` +
    `off-season Hibernate period.\n\n` +
    `- Your campaigns and assets are safely preserved\n` +
    `- No charges during the off-season (October–February)\n` +
    `- We'll reactivate automatically in March for the new season\n\n` +
    `You don't need to do anything — we've got you covered! 🌅`;

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
      console.error("Annual Pro Hibernate Manager: Telegram notification failed", {
        chatId,
        status: response.status,
      });
    }
  } catch (err) {
    console.error("Annual Pro Hibernate Manager: Telegram notification error", {
      error: err instanceof Error ? err.message : "Unknown",
      chatId,
    });
  }
}