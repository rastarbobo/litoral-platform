/**
 * Guardian Report Generator — Story 7.3 (Task 4.4)
 *
 * Cloudflare Worker cron that runs on the 1st of each month at 06:00 UTC.
 * Generates monthly SEO Guardianship Reports for all restaurants in
 * Local SEO Guardian mode.
 *
 * ADR-001 compliance: Worker cron for simple D1 query + notification.
 * Not complex enough to warrant n8n orchestration overhead.
 */

import { eq, and, inArray } from "drizzle-orm";
import { getDB } from "@/db";
import { restaurantsTable, OPERATIONAL_MODE } from "@/db/schema";
import { generateAndPersistReport } from "@/services/guardian-report-engine";
import { tryCatch } from "@/lib/try-catch";

// ─── Worker Entry Point ──────────────────────────────────

// Cloudflare Worker entry point — not imported by any other module.
// eslint-disable-next-line project/no-unused-module-exports
export async function scheduled(
  _event: ScheduledEvent,
  env: { TELEGRAM_BOT_TOKEN?: string },
  __ctx: ExecutionContext,
): Promise<void> {
  console.info("Guardian Report Generator: starting monthly report generation");
  await generateAllReports(env);
  console.info("Guardian Report Generator: monthly report generation complete");
}

// Cloudflare Worker entry point — not imported by any other module.
// eslint-disable-next-line project/no-unused-module-exports
export async function fetch(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { error } = await tryCatch(generateAllReports({}));

  if (error) {
    console.error("Guardian Report Generator: manual trigger failed", { error });
    return new Response(
      JSON.stringify({ status: "error", message: "Report generation failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ status: "success", message: "Reports generated" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// ─── Core Logic ──────────────────────────────────────────

interface ReportEnv {
  TELEGRAM_BOT_TOKEN?: string;
}

async function generateAllReports(env: ReportEnv): Promise<void> {
  const db = getDB();

  // 1. Find all restaurants in Local SEO Guardian mode
  const { data: guardianRestaurants, error: queryError } = await tryCatch(
    db
      .select({
        id: restaurantsTable.id,
        name: restaurantsTable.name,
        telegramChatId: restaurantsTable.telegramChatId,
      })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.operationalMode, OPERATIONAL_MODE.LOCAL_SEO_GUARDIAN)),
  );

  if (queryError) {
    console.error("Guardian Report Generator: failed to query guardian restaurants", {
      error: queryError,
    });
    return;
  }

  if (!guardianRestaurants || guardianRestaurants.length === 0) {
    console.info("Guardian Report Generator: no restaurants in guardian mode");
    return;
  }

  console.info(
    `Guardian Report Generator: generating reports for ${guardianRestaurants.length} restaurants`,
  );

  let successCount = 0;
  const successfulRestaurantIds: string[] = [];
  const now = new Date();
  const monthName = now.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

  // 2. Generate and persist a report for each guardian restaurant
  for (const restaurant of guardianRestaurants) {
    try {
      const reportId = await generateAndPersistReport(restaurant.id);

      if (reportId) {
        successCount++;
        successfulRestaurantIds.push(restaurant.id);

        // 3. Notify owner via Telegram
        if (restaurant.telegramChatId && env.TELEGRAM_BOT_TOKEN) {
          await sendReportNotification(
            env.TELEGRAM_BOT_TOKEN,
            restaurant.telegramChatId,
            restaurant.name ?? "Your restaurant",
            monthName,
          );
        }
      }
    } catch (error) {
      console.error("Guardian Report Generator: failed to generate report for restaurant", {
        error: error instanceof Error ? error.message : "Unknown",
        restaurantId: restaurant.id,
      });
      // Continue to next restaurant — fault isolation
    }
  }

  // 4. Update last_guardian_report_at only for restaurants that received a successful report.
  //    Uses Drizzle's inArray() for parameterized queries — no raw string interpolation.
  if (successfulRestaurantIds.length > 0) {
    await tryCatch(
      db
        .update(restaurantsTable)
        .set({ lastGuardianReportAt: now })
        .where(
          and(
            eq(restaurantsTable.operationalMode, OPERATIONAL_MODE.LOCAL_SEO_GUARDIAN),
            inArray(restaurantsTable.id, successfulRestaurantIds),
          ),
        ),
    );
  }

  console.info(
    `Guardian Report Generator: complete — ${successCount}/${guardianRestaurants.length} reports generated`,
  );
}

// ─── Helpers ─────────────────────────────────────────────

/**
 * Send a Telegram notification about the new monthly guardian report.
 */
async function sendReportNotification(
  botToken: string,
  chatId: string,
  restaurantName: string,
  monthName: string,
): Promise<void> {
  const message = `📊 Your **${monthName} SEO Guardian Report** is ready for ${restaurantName}.\n\nView it in your dashboard to see your ranking stability, review coverage, and more.`;

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
      console.error("Guardian Report Generator: Telegram notification failed", {
        chatId,
        status: response.status,
      });
    }
  } catch (err) {
    console.error("Guardian Report Generator: Telegram notification error", {
      error: err instanceof Error ? err.message : "Unknown",
      chatId,
    });
  }
}