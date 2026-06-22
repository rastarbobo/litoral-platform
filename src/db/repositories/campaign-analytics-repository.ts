import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDB } from "@/db";
import { campaignAnalyticsTable, campaignsTable } from "@/db/schema";
import { tryCatch } from "@/lib/try-catch";
import type { CampaignAnalytics } from "@/db/schema";

/**
 * Campaign Analytics Repository — Story 7.1
 *
 * Provides query methods for the campaign_analytics weekly aggregate table
 * used by the Results Dashboard "One Extra Table" ROI computation.
 */

export class CampaignAnalyticsRepository {
  /**
   * Sum of impressions for all campaigns published during a given week.
   */
  async getWeeklyReach(restaurantId: string, weekStart: Date): Promise<number> {
    const db = getDB();
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const { data, error } = await tryCatch(
      db
        .select({ total: sql<number>`COALESCE(SUM(impressions), 0)` })
        .from(campaignAnalyticsTable)
        .where(
          and(
            eq(campaignAnalyticsTable.restaurantId, restaurantId),
            gte(campaignAnalyticsTable.weekStart, weekStart),
            lt(campaignAnalyticsTable.weekStart, weekEnd),
          ),
        ),
    );

    if (error) {
      console.error({ msg: "CampaignAnalyticsRepository: getWeeklyReach failed", error, restaurantId, weekStart });
      return 0;
    }

    return (data?.[0]?.total as number) ?? 0;
  }

  /**
   * Sum of impressions for the previous 7-day period.
   */
  async getPreviousWeekReach(restaurantId: string, currentWeekStart: Date): Promise<number> {
    const prevWeekStart = new Date(currentWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    return this.getWeeklyReach(restaurantId, prevWeekStart);
  }

  /**
   * Get all analytics rows for a restaurant within a date range (past N days).
   * Used by analyst insight generation.
   */
  async getRecentAnalytics(restaurantId: string, daysBack: number): Promise<CampaignAnalytics[]> {
    const db = getDB();
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    const { data, error } = await tryCatch(
      db
        .select()
        .from(campaignAnalyticsTable)
        .where(
          and(
            eq(campaignAnalyticsTable.restaurantId, restaurantId),
            gte(campaignAnalyticsTable.fetchedAt, cutoff),
          ),
        )
        .orderBy(sql`${campaignAnalyticsTable.fetchedAt} DESC`),
    );

    if (error) {
      console.error({ msg: "CampaignAnalyticsRepository: getRecentAnalytics failed", error, restaurantId, daysBack });
      return [];
    }

    return data ?? [];
  }

  /**
   * Get analytics for the same week from the previous year.
   */
  async getSeasonComparison(restaurantId: string, currentWeekStart: Date): Promise<number> {
    const lastYearWeekStart = new Date(currentWeekStart);
    lastYearWeekStart.setFullYear(lastYearWeekStart.getFullYear() - 1);
    return this.getWeeklyReach(restaurantId, lastYearWeekStart);
  }

  /**
   * Count published campaigns for a restaurant.
   * Used to determine if we have enough data for insights.
   */
  async getPublishedCount(restaurantId: string): Promise<number> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(campaignsTable)
        .where(
          and(
            eq(campaignsTable.restaurantId, restaurantId),
            eq(campaignsTable.status, "published"),
          ),
        ),
    );

    if (error) {
      console.error({ msg: "CampaignAnalyticsRepository: getPublishedCount failed", error, restaurantId });
      return 0;
    }

    return (data?.[0]?.count as number) ?? 0;
  }

  /**
   * Get top performing campaign type and platform for recent campaigns.
   * Returns null if not enough data.
   */
  async getTopPerformer(restaurantId: string): Promise<{
    platform: string;
    avgEngagementBps: number;
  } | null> {
    const db = getDB();
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const { data, error } = await tryCatch(
      db
        .select({
          platform: campaignAnalyticsTable.platform,
          avgEngagementBps: sql<number>`AVG(engagement_rate_bps)`,
          count: sql<number>`COUNT(*)`,
        })
        .from(campaignAnalyticsTable)
        .where(
          and(
            eq(campaignAnalyticsTable.restaurantId, restaurantId),
            gte(campaignAnalyticsTable.fetchedAt, cutoff),
          ),
        )
        .groupBy(campaignAnalyticsTable.platform)
        .orderBy(sql`AVG(${campaignAnalyticsTable.engagementRateBps}) DESC`)
        .limit(1),
    );

    if (error || !data || data.length === 0) return null;

    const row = data[0];
    if (!row || (row.count as number) < 1) return null;

    return {
      platform: row.platform,
      avgEngagementBps: row.avgEngagementBps as number,
    };
  }
  /**
   * Get pre-season booking intent clicks for the current week.
   * Sums early_booking_intent_clicks for pre_season_booking campaigns.
   * Story 7.4.
   */
  async getPreSeasonBookingIntent(restaurantId: string, weekStart: Date): Promise<number> {
    const db = getDB();
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const { data, error } = await tryCatch(
      db
        .select({ total: sql<number>`COALESCE(SUM(${campaignAnalyticsTable.earlyBookingIntentClicks}), 0)` })
        .from(campaignAnalyticsTable)
        .innerJoin(
          campaignsTable,
          eq(campaignAnalyticsTable.campaignId, campaignsTable.id),
        )
        .where(
          and(
            eq(campaignAnalyticsTable.restaurantId, restaurantId),
            eq(campaignsTable.campaignType, "pre_season_booking"),
            gte(campaignAnalyticsTable.weekStart, weekStart),
            lt(campaignAnalyticsTable.weekStart, weekEnd),
          ),
        ),
    );

    if (error) {
      console.error({ msg: "CampaignAnalyticsRepository: getPreSeasonBookingIntent failed", error, restaurantId, weekStart });
      return 0;
    }

    return (data?.[0]?.total as number) ?? 0;
  }
}

export const campaignAnalyticsRepo = new CampaignAnalyticsRepository();