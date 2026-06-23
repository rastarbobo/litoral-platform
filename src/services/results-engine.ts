import type { ResultsData, WeeklyResult, OneExtraTable, AnalystInsight, GuardianReportData } from "@/lib/dashboard/types";
import { campaignAnalyticsRepo } from "@/db/repositories/campaign-analytics-repository";
import { getAnalystContext } from "@/services/analyst-context";
import { generateAiInsight, AiInsightGenerationError } from "@/services/ai-insight-generator";
import { getDB } from "@/db";
import {
  restaurantMetricsTable,
  restaurantsTable,
  campaignsTable,
  DEFAULT_SEO_GUARDIAN_CONFIG,
  OPERATIONAL_MODE,
} from "@/db/schema";
import type { SeoGuardianConfig } from "@/db/schema";
import { getLatestGuardianReport } from "@/services/guardian-report-engine";
import { tryCatch } from "@/lib/try-catch";
import { eq, and, gte, sql } from "drizzle-orm";

/**
 * Results Engine — Story 7.1
 *
 * Computes real analytics data for the "One Extra Table" ROI Results Dashboard.
 * Replaces the hardcoded mock data in /api/dashboard/results/route.ts.
 */

// ─── Helpers ──────────────────────────────────────────────

/**
 * Get the Monday 00:00:00 UTC for a given date.
 */
export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
  d.setUTCDate(diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Format a date as "Mon DD".
 */
function formatDateShort(date: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayName = days[date.getUTCDay()];
  const month = date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const day = date.getUTCDate();
  return `${dayName}, ${month} ${day}`;
}

/**
 * Build a human-readable period string like "Mon, 17 Jun – Sun, 23 Jun".
 */
function buildPeriod(weekStart: Date): string {
  const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
  return `${formatDateShort(weekStart)} – ${formatDateShort(weekEnd)}`;
}

// ─── Restaurant Metrics ───────────────────────────────────

interface RestaurantMetricConfig {
  localConversionRate: number;
  avgRevenuePerTable: number;
}

async function getRestaurantMetrics(restaurantId: string): Promise<RestaurantMetricConfig> {
  const db = getDB();
  const { data } = await tryCatch(
    db
      .select({
        localConversionRate: restaurantMetricsTable.localConversionRate,
        avgRevenuePerTable: restaurantMetricsTable.avgRevenuePerTable,
      })
      .from(restaurantMetricsTable)
      .where(eq(restaurantMetricsTable.restaurantId, restaurantId)),
  );

  if (data && data.length > 0) {
    return {
      localConversionRate: data[0].localConversionRate,
      avgRevenuePerTable: data[0].avgRevenuePerTable,
    };
  }

  // Defaults if no metrics row exists yet
  return {
    localConversionRate: 0.02,
    avgRevenuePerTable: 50,
  };
}

// ─── Core Computation ────────────────────────────────────

/**
 * Compute the weekly reach data.
 */
async function computeWeeklyResult(restaurantId: string): Promise<WeeklyResult | null> {
  const now = new Date();
  const weekStart = getMondayOfWeek(now);

  const [thisWeekReach, lastWeekReach] = await Promise.all([
    campaignAnalyticsRepo.getWeeklyReach(restaurantId, weekStart),
    campaignAnalyticsRepo.getPreviousWeekReach(restaurantId, weekStart),
  ]);

  // If no campaigns published at all (both weeks zero), return null
  if (thisWeekReach === 0 && lastWeekReach === 0) {
    return null;
  }

  // Compute percent change (handle division by zero)
  let percentChange = 0;
  if (lastWeekReach > 0) {
    percentChange = Math.round(((thisWeekReach - lastWeekReach) / lastWeekReach) * 100);
  } else if (thisWeekReach > 0) {
    percentChange = 100; // First week with data — show 100% growth from 0
  } else if (thisWeekReach === 0 && lastWeekReach > 0) {
    percentChange = -100; // Dropped to zero from positive
  }

  return {
    estimatedReach: thisWeekReach,
    percentChange,
    period: buildPeriod(weekStart),
  };
}

/**
 * Compute the "One Extra Table" ROI text.
 */
async function computeOneExtraTable(restaurantId: string, estimatedReach: number): Promise<OneExtraTable> {
  const metrics = await getRestaurantMetrics(restaurantId);

  // Compute without premature rounding to preserve precision per AC 3
  const rawExtraTables = estimatedReach * metrics.localConversionRate;
  const extraTables = Math.round(rawExtraTables);
  const extraRevenue = Math.round(rawExtraTables * metrics.avgRevenuePerTable);

  // 0 tables edge case
  if (extraTables === 0) {
    return {
      text:
        "Based on your estimated reach and the local conversion rate, the platform helped bring in 0 extra tables this week. " +
        "Your reach is growing — keep publishing to see results.",
    };
  }

  const tablesWord = extraTables === 1 ? "table" : "tables";

  return {
    text:
      `Based on your estimated reach and the local conversion rate, ` +
      `the platform helped bring in ${extraTables} extra ${tablesWord} this week ` +
      `— that's roughly $${extraRevenue.toLocaleString()} in additional revenue.`,
  };
}

/**
 * Generate a plain-English analyst insight.
 *
 * Story 7.2: AI-powered insights via Cloudflare AI Gateway.
 * Falls back to rule-based logic on AI failure or insufficient data.
 */
async function ruleBasedInsight(restaurantId: string): Promise<AnalystInsight> {
  const top = await campaignAnalyticsRepo.getTopPerformer(restaurantId);

  if (top && top.avgEngagementBps > 0) {
    const engagementPct = (top.avgEngagementBps / 100).toFixed(1);
    const platformName = top.platform.charAt(0).toUpperCase() + top.platform.slice(1);

    return {
      quote:
        `Your ${platformName} posts are currently your strongest channel, ` +
        `averaging ${engagementPct}% engagement. ` +
        `Consider publishing more content there to maximize your results.`,
      source: "analyst",
    };
  }

  return {
    quote:
      "You're consistently publishing content — keep it up! " +
      "As we gather more data, we'll surface which post types and platforms perform best for your audience.",
    source: "analyst",
  };
}

async function computeAnalystInsight(restaurantId: string): Promise<AnalystInsight> {
  const publishedCount = await campaignAnalyticsRepo.getPublishedCount(restaurantId);

  // Not enough data — preserve Story 7.1 fallback (AC 3)
  if (publishedCount < 3) {
    return {
      quote: "Not enough data yet to generate insights. Check back next week.",
      source: "analyst",
    };
  }

  // AI-powered path (AC 2)
  try {
    const ctx = await getAnalystContext(restaurantId);

    // getAnalystContext returns null when there's no analytics data
    if (!ctx) {
      return ruleBasedInsight(restaurantId);
    }

    const aiInsight = await generateAiInsight(ctx);
    return { quote: aiInsight.quote, source: "analyst" };
  } catch (error) {
    // Graceful fallback on AI failure (AC 5)
    console.error("[Results Engine] AI insight generation failed, falling back to rule-based:", error);
    return ruleBasedInsight(restaurantId);
  }
}

// ─── Public API ──────────────────────────────────────────

/**
 * Compute the complete ResultsData for the "One Extra Table" ROI dashboard.
 *
 * Returns null if no campaigns have been published yet (empty state).
 */
export async function computeResultsData(restaurantId: string): Promise<ResultsData | null> {
  const weeklyResult = await computeWeeklyResult(restaurantId);

  // Fetch pre-season booking intent regardless of weekly result —
  // booking clicks can exist even when no campaigns were published this week
  // (e.g., clicks from a prior season's campaign still tracked in analytics)
  const preSeasonClicks = await campaignAnalyticsRepo.getPreSeasonBookingIntent(
    restaurantId,
    getMondayOfWeek(new Date()),
  );

  if (!weeklyResult) {
    // No campaigns published — but booking intent may still be meaningful
    if (preSeasonClicks > 0) {
      return {
        thisWeek: {
          estimatedReach: 0,
          percentChange: 0,
          period: buildPeriod(getMondayOfWeek(new Date())),
        },
        oneExtraTable: {
          text: `No campaigns published this week.\n\nHowever, ${preSeasonClicks} early booking signal${preSeasonClicks !== 1 ? "s" : ""} detected — these are potential reservations for next season.`,
        },
        analystInsight: {
          quote: "Early booking campaigns are generating interest for next season. Consider publishing content to convert these signals into reservations.",
          source: "analyst",
        },
      };
    }
    return null; // Empty state — no campaigns published, no booking signals
  }

  const [oneExtraTable, analystInsight] = await Promise.all([
    computeOneExtraTable(restaurantId, weeklyResult.estimatedReach),
    computeAnalystInsight(restaurantId),
  ]);

  let enrichedOneExtraTable = { ...oneExtraTable };
  if (preSeasonClicks > 0) {
    enrichedOneExtraTable.text = oneExtraTable.text +
      `\n\nAdditionally, ${preSeasonClicks} early booking signals were detected this week — these are potential reservations for next season.`;
  }

  return {
    thisWeek: weeklyResult,
    oneExtraTable: enrichedOneExtraTable,
    analystInsight,
  };
}

/**
 * Get the guardian mode status for a restaurant.
 * Returns null if the restaurant is not in guardian mode.
 */
export async function getGuardianMode(restaurantId: string): Promise<ResultsData["guardianMode"]> {
  const db = getDB();

  const { data: rows } = await tryCatch(
    db
      .select({
        operationalMode: restaurantsTable.operationalMode,
        guardianModeSince: restaurantsTable.guardianModeSince,
        seoGuardianConfig: restaurantsTable.seoGuardianConfig,
      })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.id, restaurantId)),
  );

  const restaurant = rows?.[0];
  if (!restaurant || !restaurant.operationalMode) return null;

  // Only return guardian mode data if the restaurant IS in guardian mode
  if (restaurant.operationalMode !== OPERATIONAL_MODE.LOCAL_SEO_GUARDIAN) {
    return null;
  }

  const config: SeoGuardianConfig =
    (restaurant.seoGuardianConfig as SeoGuardianConfig) ?? DEFAULT_SEO_GUARDIAN_CONFIG;

  // Count guardian posts this week (only published/scheduled/approved count toward cadence)
  const weekStart = getMondayOfWeek(new Date());
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const { data: postData } = await tryCatch(
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(campaignsTable)
      .where(
        and(
          eq(campaignsTable.restaurantId, restaurantId),
          eq(campaignsTable.campaignType, "guardian"),
          gte(sql`created_at`, weekStart.getTime()),
          sql`created_at < ${weekEnd.getTime()}`,
          sql`${campaignsTable.status} IN ('approved', 'scheduled', 'published')`,
        ),
      ),
  );

  const postsThisWeek = (postData?.[0]?.count as number) ?? 0;

  return {
    enabled: true,
    mode: "local_seo_guardian",
    since: restaurant.guardianModeSince
      ? new Date(restaurant.guardianModeSince as number).toISOString()
      : null,
    postsThisWeek,
    postsTarget: config.postsPerWeek ?? 2,
  };
}

/**
 * Get the monthly guardian report for the dashboard.
 * Returns null if no report has been generated yet.
 */
export async function getGuardianReport(restaurantId: string): Promise<GuardianReportData | null> {
  return getLatestGuardianReport(restaurantId);
}

/**
 * Get the season comparison (same week from previous year).
 * Returns null for first-season restaurants.
 */
export async function getSeasonComparison(restaurantId: string): Promise<WeeklyResult | null> {
  const now = new Date();
  const weekStart = getMondayOfWeek(now);
  const lastYearReach = await campaignAnalyticsRepo.getSeasonComparison(restaurantId, weekStart);

  if (lastYearReach === 0) return null;

  // Use 52-week subtraction to preserve same week number and avoid leap-year / day-of-week drift
  const lastYearWeekStart = new Date(weekStart);
  lastYearWeekStart.setDate(lastYearWeekStart.getDate() - 52 * 7);

  return {
    estimatedReach: lastYearReach,
    percentChange: 0, // We don't compute change here — this is just the raw comparison
    period: buildPeriod(lastYearWeekStart),
  };
}