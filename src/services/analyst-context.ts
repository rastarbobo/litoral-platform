import { campaignAnalyticsRepo } from "@/db/repositories/campaign-analytics-repository";

/**
 * Analyst Context Builder — Story 7.2
 *
 * Queries D1 for restaurant campaign performance data and builds a structured
 * context object used as the AI prompt input for generating plain-English insights.
 */

// ─── Types ─────────────────────────────────────────────────

export interface AnalystPromptContext {
  businessName: string;
  currentWeek: {
    totalReach: number;
    engagementRateBps: number;
  };
  previousWeek: {
    totalReach: number;
    engagementRateBps: number;
  };
  topPlatform: {
    platform: string;
    impressions: number;
    engagementRateBps: number;
  } | null;
  totalPublishedCampaigns: number;
  trend: "rising" | "falling" | "stable";
}

// ─── Helpers ──────────────────────────────────────────────

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function computeTrend(
  currentReach: number,
  previousReach: number,
): "rising" | "falling" | "stable" {
  if (currentReach === 0 && previousReach === 0) return "stable";
  if (previousReach === 0) return "rising";
  const pctChange = ((currentReach - previousReach) / previousReach) * 100;
  if (pctChange > 5) return "rising";
  if (pctChange < -5) return "falling";
  return "stable";
}

// ─── Public API ──────────────────────────────────────────

/**
 * Build the analyst prompt context for a restaurant.
 *
 * Queries campaign analytics for the past 14 days to build a structured
 * snapshot of performance: reach, engagement, top platform, and trend.
 *
 * Returns null if there are no published campaigns with analytics data.
 */
export async function getAnalystContext(
  restaurantId: string,
): Promise<AnalystPromptContext | null> {
  // Check if we have enough published campaigns
  const publishedCount = await campaignAnalyticsRepo.getPublishedCount(restaurantId);
  if (publishedCount < 3) return null;

  // Get current and previous week stats
  const now = new Date();
  const currentWeekStart = getMondayOfWeek(now);
  const previousWeekStart = new Date(currentWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [currentReach, previousReach] = await Promise.all([
    campaignAnalyticsRepo.getWeeklyReach(restaurantId, currentWeekStart),
    campaignAnalyticsRepo.getWeeklyReach(restaurantId, previousWeekStart),
  ]);

  // Get recent analytics for engagement rate computation
  const recentAnalytics = await campaignAnalyticsRepo.getRecentAnalytics(restaurantId, 14);

  // Compute current week engagement rate
  const currentWeekRows = recentAnalytics.filter((r) => {
    const ws = new Date(r.weekStart);
    return ws.getTime() >= currentWeekStart.getTime();
  });

  const previousWeekRows = recentAnalytics.filter((r) => {
    const ws = new Date(r.weekStart);
    return (
      ws.getTime() >= previousWeekStart.getTime() &&
      ws.getTime() < currentWeekStart.getTime()
    );
  });

  const currentEngagementBps =
    currentWeekRows.length > 0
      ? Math.round(
          currentWeekRows.reduce((sum, r) => sum + r.engagementRateBps, 0) /
            currentWeekRows.length,
        )
      : 0;

  const previousEngagementBps =
    previousWeekRows.length > 0
      ? Math.round(
          previousWeekRows.reduce((sum, r) => sum + r.engagementRateBps, 0) /
            previousWeekRows.length,
        )
      : 0;

  // Get top performing platform
  const topPlatform = await campaignAnalyticsRepo.getTopPerformer(restaurantId);

  // Compute trend
  const trend = computeTrend(currentReach, previousReach);

  return {
    businessName: "", // Populated by caller if available (not needed for AI prompt)
    currentWeek: {
      totalReach: currentReach,
      engagementRateBps: currentEngagementBps,
    },
    previousWeek: {
      totalReach: previousReach,
      engagementRateBps: previousEngagementBps,
    },
    topPlatform: topPlatform
      ? {
          platform: topPlatform.platform,
          impressions: 0, // We don't have per-platform impression count in getTopPerformer
          engagementRateBps: topPlatform.avgEngagementBps,
        }
      : null,
    totalPublishedCampaigns: publishedCount,
    trend,
  };
}