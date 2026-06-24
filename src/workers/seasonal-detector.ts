/**
 * Seasonal Mode Detector — Story 7.3 (Task 2.4)
 *
 * Cloudflare Worker cron that runs once per day at 03:00 UTC.
 * Detects end of peak season and transitions restaurants into
 * Local SEO Guardian mode via atomic D1 updates.
 *
 * ADR-001 compliance: Worker cron for simple state transitions (read D1, write D1).
 * Does not require n8n — no AI calls, no multi-step orchestration.
 *
 * ADR-003 compliance: Atomic updates with state-precondition checks
 * (UPDATE ... WHERE operational_mode = 'peak_season').
 */

import { eq, and } from "drizzle-orm";
import { getDB } from "@/db";
import {
  restaurantsTable,
  DEFAULT_SEO_GUARDIAN_CONFIG,
  OPERATIONAL_MODE,
} from "@/db/schema";
import type { SeoGuardianConfig } from "@/db/schema";
import { tryCatch } from "@/lib/try-catch";

// ─── Worker Entry Point ──────────────────────────────────

// Cloudflare Worker entry point — not imported by any other module.
// eslint-disable-next-line project/no-unused-module-exports
export async function scheduled(
  _event: ScheduledEvent,
  env: { TELEGRAM_BOT_TOKEN?: string },
  __ctx: ExecutionContext,
): Promise<void> {
  console.info("Seasonal Mode Detector: starting daily scan");
  await detectAndTransitionSeasons(env);
  console.info("Seasonal Mode Detector: daily scan complete");
}

// Cloudflare Worker entry point — not imported by any other module.
// eslint-disable-next-line project/no-unused-module-exports
export async function handleRequest(request: Request): Promise<Response> {
  // Only allow POST from local/dev environment for manual triggers
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { error } = await tryCatch(
    detectAndTransitionSeasons({}),
  );

  if (error) {
    console.error("Seasonal Mode Detector: manual trigger failed", { error });
    return new Response(
      JSON.stringify({ status: "error", message: "Detection failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ status: "success", message: "Detection complete" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// ─── Core Detection Logic ────────────────────────────────

interface DetectorEnv {
  TELEGRAM_BOT_TOKEN?: string;
}

async function detectAndTransitionSeasons(env: DetectorEnv): Promise<void> {
  const db = getDB();
  const now = new Date();
  const currentMonth = now.getMonth() + 1; // 1-indexed (January = 1)

  // 1. Find all restaurants currently in peak_season mode
  const { data: peakSeasonRestaurants, error: queryError } = await tryCatch(
    db
      .select({
        id: restaurantsTable.id,
        name: restaurantsTable.name,
        slug: restaurantsTable.slug,
        telegramChatId: restaurantsTable.telegramChatId,
        seoGuardianConfig: restaurantsTable.seoGuardianConfig,
        operationalMode: restaurantsTable.operationalMode,
        cuisineType: restaurantsTable.cuisineType,
        location: restaurantsTable.location,
      })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.operationalMode, OPERATIONAL_MODE.PEAK_SEASON)),
  );

  if (queryError) {
    console.error("Seasonal Mode Detector: failed to query peak-season restaurants", {
      error: queryError,
    });
    return;
  }

  if (!peakSeasonRestaurants || peakSeasonRestaurants.length === 0) {
    console.info("Seasonal Mode Detector: no peak-season restaurants to check");
    return;
  }

  console.info(`Seasonal Mode Detector: checking ${peakSeasonRestaurants.length} peak-season restaurants`);

  let transitionedCount = 0;

  // 2. Check each restaurant against its seo_guardian_config
  for (const restaurant of peakSeasonRestaurants) {
    // Story 7.5: Explicit hibernate guard — never transition hibernate restaurants
    if (restaurant.operationalMode === OPERATIONAL_MODE.HIBERNATE) {
      console.info("Seasonal Mode Detector: skipping hibernate restaurant", {
        restaurantId: restaurant.id,
      });
      continue;
    }

    const config = resolveConfig(restaurant.seoGuardianConfig as SeoGuardianConfig | null);

    // Guardian window: current month is between peakSeasonEndMonth and guardianEndMonth
    // Handles year-wrap: e.g. peakSeasonEndMonth=11, guardianEndMonth=2 -> Nov..Feb
    const isInGuardianWindow =
      config.guardianEndMonth >= config.peakSeasonEndMonth
        ? (currentMonth >= config.peakSeasonEndMonth && currentMonth <= config.guardianEndMonth)
        : (currentMonth >= config.peakSeasonEndMonth || currentMonth <= config.guardianEndMonth);

    if (isInGuardianWindow) {
      // 3. Atomic update with state-precondition check (ADR-003)
      const { data: updateResult, error: updateError } = await tryCatch(
        db
          .update(restaurantsTable)
          .set({
            operationalMode: OPERATIONAL_MODE.LOCAL_SEO_GUARDIAN,
            modeChangedAt: now,
            guardianModeSince: now,
            peakSeasonEndDetectedAt: now,
          })
          .where(
            and(
              eq(restaurantsTable.id, restaurant.id),
              eq(restaurantsTable.operationalMode, OPERATIONAL_MODE.PEAK_SEASON),
            ),
          )
          .returning({ id: restaurantsTable.id, name: restaurantsTable.name }),
      );

      if (updateError) {
        console.error("Seasonal Mode Detector: failed to transition restaurant", {
          error: updateError,
          restaurantId: restaurant.id,
        });
        continue;
      }

      // No rows updated → another process already changed the mode (race condition handled)
      if (!updateResult || updateResult.length === 0) {
        console.info("Seasonal Mode Detector: restaurant already transitioned (race)", {
          restaurantId: restaurant.id,
        });
        continue;
      }

      transitionedCount++;
      console.info("Seasonal Mode Detector: transitioned restaurant to guardian mode", {
        restaurantId: restaurant.id,
        name: restaurant.name,
        month: currentMonth,
      });

      // 4. Send Telegram notification to owner
      if (restaurant.telegramChatId && env.TELEGRAM_BOT_TOKEN) {
        await sendGuardianTransitionNotification(
          env.TELEGRAM_BOT_TOKEN,
          restaurant.telegramChatId,
          restaurant.name ?? "Your restaurant",
          config,
        );
      }
    }
  }

  console.info(
    `Seasonal Mode Detector: scan complete — ${transitionedCount} restaurants transitioned`,
  );
}

// ─── Helpers ─────────────────────────────────────────────

/**
 * Resolve SEO Guardian config from DB, falling back to system defaults.
 */
function resolveConfig(dbConfig: SeoGuardianConfig | null): SeoGuardianConfig {
  if (!dbConfig) return { ...DEFAULT_SEO_GUARDIAN_CONFIG };

  return {
    peakSeasonEndMonth: dbConfig.peakSeasonEndMonth ?? DEFAULT_SEO_GUARDIAN_CONFIG.peakSeasonEndMonth,
    guardianStartMonth: dbConfig.guardianStartMonth ?? DEFAULT_SEO_GUARDIAN_CONFIG.guardianStartMonth,
    guardianEndMonth: dbConfig.guardianEndMonth ?? DEFAULT_SEO_GUARDIAN_CONFIG.guardianEndMonth,
    postsPerWeek: dbConfig.postsPerWeek ?? DEFAULT_SEO_GUARDIAN_CONFIG.postsPerWeek,
    guardianContentTypes:
      dbConfig.guardianContentTypes ?? DEFAULT_SEO_GUARDIAN_CONFIG.guardianContentTypes,
    reviewResponseEnabled:
      dbConfig.reviewResponseEnabled ?? DEFAULT_SEO_GUARDIAN_CONFIG.reviewResponseEnabled,
    monthlyReportEnabled:
      dbConfig.monthlyReportEnabled ?? DEFAULT_SEO_GUARDIAN_CONFIG.monthlyReportEnabled,
  };
}

/**
 * Send a Telegram notification to the restaurant owner about the mode transition.
 */
async function sendGuardianTransitionNotification(
  botToken: string,
  chatId: string,
  restaurantName: string,
  config: SeoGuardianConfig,
): Promise<void> {
  // Determine spring month name for the "see you in" message
  const springMonthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const springMonth = springMonthNames[config.guardianEndMonth >= 11 ? 3 : 0]; // April or January

  const message =
    `🌊 Peak season is winding down for ${restaurantName}.\n\n` +
    `Litoral has shifted to **Off-Season Guardian mode** — I'll keep your Google presence alive with ` +
    `${config.postsPerWeek} post${config.postsPerWeek > 1 ? "s" : ""}/week and monitor your reviews. ` +
    `You don't need to do anything.\n\n` +
    `☀️ See you in ${springMonth}!`;

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
      console.error("Seasonal Mode Detector: Telegram notification failed", {
        chatId,
        status: response.status,
      });
    }
  } catch (err) {
    console.error("Seasonal Mode Detector: Telegram notification error", {
      error: err instanceof Error ? err.message : "Unknown",
      chatId,
    });
  }
}