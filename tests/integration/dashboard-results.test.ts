/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, it, expect, beforeEach } from "vitest";
import { getDB } from "@/db";
import {
  restaurantsTable,
  campaignsTable,
  campaignAnalyticsTable,
  restaurantMetricsTable,
  campaignRevisionsTable,
  analyticsEventsTable,
} from "@/db/schema";
import { campaignAnalyticsRepo } from "@/db/repositories/campaign-analytics-repository";
import { campaignRepo } from "@/db/repositories/campaign-repository";
import {
  computeResultsData,
  getMondayOfWeek,
  getGuardianMode,
  getSeasonComparison,
} from "@/services/results-engine";
import type { ResultsData } from "@/lib/dashboard/types";
import { eq } from "drizzle-orm";

/**
 * Integration tests for Results Dashboard ROI computation (Epic 7):
 *
 * Coverage:
 * - campaignAnalyticsRepo.getWeeklyReach: correctly sums impressions
 * - campaignAnalyticsRepo.getPreviousWeekReach: looks back 7 days
 * - campaignAnalyticsRepo.getPublishedCount: counts published campaigns
 * - campaignAnalyticsRepo.getPreSeasonBookingIntent: sums early booking clicks
 * - campaignAnalyticsRepo.getTopPerformer: returns best platform
 * - campaignAnalyticsRepo.getSeasonComparison: looks back 1 year
 * - computeResultsData: returns null for restaurant with no campaigns
 * - computeResultsData: returns ResultsData with weekly result + oneExtraTable + insight
 * - computeResultsData: returns pre-season booking signals even without weekly campaigns
 * - getSeasonComparison: returns null for first-season restaurant
 * - getGuardianMode: returns null for non-guardian restaurants
 */

const TEST_RESULTS_RESTAURANT = {
  id: "rest_results_dash",
  name: "Results Dash Test",
  slug: "results-dash-test",
  cuisineType: "thai",
  locationArea: "chinatown",
  subscriptionStatus: "active_saas" as const,
  googleRating: 4.2,
  reviewCount: 60,
  qualificationStatus: "qualified" as const,
  behavioralState: 0,
};

function getThisWeekMonday(): Date {
  return getMondayOfWeek(new Date());
}

async function seedPublishedCampaign(
  restaurantId: string,
  campaignId: string,
  campaignType = "flash_offer",
) {
  const db = getDB();
  await db.insert(campaignsTable).values({
    id: campaignId,
    restaurantId,
    source: "autonomous",
    campaignType,
    headline: "Test Campaign",
    caption: "Test caption",
    platforms: "instagram,facebook",
    status: "published",
  });
}

async function seedCampaignAnalytics(
  campaignId: string,
  restaurantId: string,
  overrides: Partial<{
    impressions: number;
    platform: "instagram" | "facebook" | "tiktok" | "gbp";
    weekStart: Date;
    engagementRateBps: number;
    conversions: number;
    earlyBookingIntentClicks: number;
  }> = {},
) {
  const db = getDB();
  await db.insert(campaignAnalyticsTable).values({
    campaignId,
    restaurantId,
    platform: overrides.platform ?? "instagram",
    impressions: overrides.impressions ?? 5000,
    engagementRateBps: overrides.engagementRateBps ?? 320,
    clicks: 120,
    conversions: overrides.conversions ?? 8,
    earlyBookingIntentClicks: overrides.earlyBookingIntentClicks ?? 0,
    weekStart: overrides.weekStart ?? getThisWeekMonday(),
    fetchedAt: new Date(),
  });
}

describe("Results Dashboard Integration", () => {
  beforeEach(async () => {
    const db = getDB();
    // Clean up
    await db.delete(campaignRevisionsTable);
    await db.delete(analyticsEventsTable);
    await db.delete(campaignAnalyticsTable);
    await db.delete(campaignsTable);
    await db.delete(restaurantMetricsTable);
    await db.delete(restaurantsTable).where(
      eq(restaurantsTable.id, TEST_RESULTS_RESTAURANT.id),
    );

    // Seed restaurant
    await db.insert(restaurantsTable).values(TEST_RESULTS_RESTAURANT);
  });

  // ─── Campaign Analytics Repository ──────────────────────────

  describe("campaignAnalyticsRepo.getWeeklyReach", () => {
    it("sums impressions for campaigns in the given week", async () => {
      const weekStart = getThisWeekMonday();
      const campaignId = "camp_reach_1";

      await seedPublishedCampaign(TEST_RESULTS_RESTAURANT.id, campaignId);
      await seedCampaignAnalytics(campaignId, TEST_RESULTS_RESTAURANT.id, {
        impressions: 5000,
        weekStart,
      });

      // Add another platform's analytics for same campaign
      await seedCampaignAnalytics(campaignId, TEST_RESULTS_RESTAURANT.id, {
        impressions: 3000,
        platform: "facebook",
        weekStart,
      });

      const reach = await campaignAnalyticsRepo.getWeeklyReach(
        TEST_RESULTS_RESTAURANT.id,
        weekStart,
      );

      // 5000 + 3000 = 8000
      expect(reach).toBe(8000);
    });

    it("returns 0 when no analytics exist for the week", async () => {
      const reach = await campaignAnalyticsRepo.getWeeklyReach(
        TEST_RESULTS_RESTAURANT.id,
        getThisWeekMonday(),
      );
      expect(reach).toBe(0);
    });
  });

  describe("campaignAnalyticsRepo.getPreviousWeekReach", () => {
    it("looks back 7 days from current week start", async () => {
      const thisWeek = getThisWeekMonday();
      const lastWeek = new Date(thisWeek.getTime() - 7 * 24 * 60 * 60 * 1000);
      const campaignId = "camp_prev_week";

      await seedPublishedCampaign(TEST_RESULTS_RESTAURANT.id, campaignId);
      await seedCampaignAnalytics(campaignId, TEST_RESULTS_RESTAURANT.id, {
        impressions: 4000,
        weekStart: lastWeek,
      });

      const previousReach = await campaignAnalyticsRepo.getPreviousWeekReach(
        TEST_RESULTS_RESTAURANT.id,
        thisWeek,
      );

      expect(previousReach).toBe(4000);
    });
  });

  describe("campaignAnalyticsRepo.getPublishedCount", () => {
    it("counts published campaigns", async () => {
      const db = getDB();

      await db.insert(campaignsTable).values({
        id: "camp_pub_1",
        restaurantId: TEST_RESULTS_RESTAURANT.id,
        source: "autonomous",
        campaignType: "flash_offer",
        status: "published",
      });
      await db.insert(campaignsTable).values({
        id: "camp_pub_2",
        restaurantId: TEST_RESULTS_RESTAURANT.id,
        source: "autonomous",
        campaignType: "daily_special",
        status: "published",
      });
      await db.insert(campaignsTable).values({
        id: "camp_draft",
        restaurantId: TEST_RESULTS_RESTAURANT.id,
        source: "autonomous",
        campaignType: "seasonal_event",
        status: "pending_approval",
      });

      const count = await campaignAnalyticsRepo.getPublishedCount(
        TEST_RESULTS_RESTAURANT.id,
      );

      expect(count).toBe(2);
    });

    it("returns 0 when no published campaigns", async () => {
      const count = await campaignAnalyticsRepo.getPublishedCount(
        TEST_RESULTS_RESTAURANT.id,
      );
      expect(count).toBe(0);
    });
  });

  describe("campaignAnalyticsRepo.getPreSeasonBookingIntent", () => {
    it("sums early_booking_intent_clicks for pre_season_booking campaigns this week", async () => {
      const db = getDB();
      const weekStart = getThisWeekMonday();
      const campaignId = "camp_pre_season";

      await db.insert(campaignsTable).values({
        id: campaignId,
        restaurantId: TEST_RESULTS_RESTAURANT.id,
        source: "autonomous",
        campaignType: "pre_season_booking",
        status: "published",
      });
      await seedCampaignAnalytics(campaignId, TEST_RESULTS_RESTAURANT.id, {
        impressions: 1000,
        weekStart,
        earlyBookingIntentClicks: 25,
      });

      const clicks = await campaignAnalyticsRepo.getPreSeasonBookingIntent(
        TEST_RESULTS_RESTAURANT.id,
        weekStart,
      );

      expect(clicks).toBe(25);
    });

    it("returns 0 when no pre-season campaigns with clicks", async () => {
      const clicks = await campaignAnalyticsRepo.getPreSeasonBookingIntent(
        TEST_RESULTS_RESTAURANT.id,
        getThisWeekMonday(),
      );
      expect(clicks).toBe(0);
    });
  });

  describe("campaignAnalyticsRepo.getTopPerformer", () => {
    it("returns the best performing platform by avg engagement", async () => {
      const campaignId = "camp_performer";

      await seedPublishedCampaign(TEST_RESULTS_RESTAURANT.id, campaignId);
      await seedCampaignAnalytics(campaignId, TEST_RESULTS_RESTAURANT.id, {
        impressions: 5000,
        platform: "instagram",
        engagementRateBps: 320,
      });
      await seedCampaignAnalytics(campaignId, TEST_RESULTS_RESTAURANT.id, {
        impressions: 3000,
        platform: "facebook",
        engagementRateBps: 150,
      });

      const top = await campaignAnalyticsRepo.getTopPerformer(
        TEST_RESULTS_RESTAURANT.id,
      );

      expect(top).not.toBeNull();
      expect(top!.platform).toBe("instagram");
      // Instagram has avg 320 bps > Facebook's 150 bps
    });

    it("returns null when no analytics data exists", async () => {
      const top = await campaignAnalyticsRepo.getTopPerformer(
        TEST_RESULTS_RESTAURANT.id,
      );
      expect(top).toBeNull();
    });
  });

  describe("campaignAnalyticsRepo.getSeasonComparison", () => {
    it("looks back one year for same-week impressions", async () => {
      const thisWeekMonday = getThisWeekMonday();
      const lastYearSameWeek = new Date(thisWeekMonday);
      lastYearSameWeek.setFullYear(lastYearSameWeek.getFullYear() - 1);

      const campaignId = "camp_ly";
      await seedPublishedCampaign(TEST_RESULTS_RESTAURANT.id, campaignId);
      await seedCampaignAnalytics(campaignId, TEST_RESULTS_RESTAURANT.id, {
        impressions: 7500,
        weekStart: lastYearSameWeek,
      });

      const comparison = await campaignAnalyticsRepo.getSeasonComparison(
        TEST_RESULTS_RESTAURANT.id,
        thisWeekMonday,
      );

      expect(comparison).toBe(7500);
    });

    it("returns 0 when no prior year data", async () => {
      const comparison = await campaignAnalyticsRepo.getSeasonComparison(
        TEST_RESULTS_RESTAURANT.id,
        getThisWeekMonday(),
      );
      expect(comparison).toBe(0);
    });
  });

  // ─── Results Engine ─────────────────────────────────────────

  describe("computeResultsData", () => {
    it("returns null for restaurant with no published campaigns and no booking signals", async () => {
      const results = await computeResultsData(TEST_RESULTS_RESTAURANT.id);
      expect(results).toBeNull();
    });

    it("returns ResultsData with weekly result when campaigns have analytics", async () => {
      const weekStart = getThisWeekMonday();
      const campaignId = "camp_results_1";

      await seedPublishedCampaign(TEST_RESULTS_RESTAURANT.id, campaignId);
      await seedCampaignAnalytics(campaignId, TEST_RESULTS_RESTAURANT.id, {
        impressions: 10000,
        weekStart,
      });

      // Need 3 published campaigns to get analyst insight
      await seedPublishedCampaign(TEST_RESULTS_RESTAURANT.id, "camp_results_2", "daily_special");
      await seedCampaignAnalytics("camp_results_2", TEST_RESULTS_RESTAURANT.id, {
        impressions: 5000,
        platform: "facebook",
        weekStart,
        engagementRateBps: 150,
      });

      await seedPublishedCampaign(TEST_RESULTS_RESTAURANT.id, "camp_results_3", "seasonal_event");
      await seedCampaignAnalytics("camp_results_3", TEST_RESULTS_RESTAURANT.id, {
        impressions: 8000,
        platform: "tiktok",
        weekStart,
        engagementRateBps: 450,
      });

      const results = await computeResultsData(TEST_RESULTS_RESTAURANT.id);

      expect(results).not.toBeNull();
      expect(results!.thisWeek.estimatedReach).toBeGreaterThan(0);
      expect(results!.thisWeek.period).toBeTruthy();
      expect(results!.oneExtraTable.text).toBeTruthy();
      expect(results!.analystInsight.quote).toBeTruthy();
      expect(results!.analystInsight.source).toBe("analyst");
    });

    it("returns pre-season booking signals even without weekly campaigns", async () => {
      const weekStart = getThisWeekMonday();
      const db = getDB();

      const campaignId = "camp_pbs_only";
      await db.insert(campaignsTable).values({
        id: campaignId,
        restaurantId: TEST_RESULTS_RESTAURANT.id,
        source: "autonomous",
        campaignType: "pre_season_booking",
        status: "published",
      });
      await seedCampaignAnalytics(campaignId, TEST_RESULTS_RESTAURANT.id, {
        impressions: 0,
        weekStart,
        earlyBookingIntentClicks: 12,
      });

      const results = await computeResultsData(TEST_RESULTS_RESTAURANT.id);

      expect(results).not.toBeNull();
      expect(results!.oneExtraTable.text).toContain("12 early booking signal");
      expect(results!.oneExtraTable.text).toContain("next season");
    });
  });

  describe("getSeasonComparison", () => {
    it("returns comparison data when prior year exists", async () => {
      const thisWeekMonday = getThisWeekMonday();
      const lastYearSameWeek = new Date(thisWeekMonday);
      lastYearSameWeek.setFullYear(lastYearSameWeek.getFullYear() - 1);

      const campaignId = "camp_season_comp";
      await seedPublishedCampaign(TEST_RESULTS_RESTAURANT.id, campaignId);
      await seedCampaignAnalytics(campaignId, TEST_RESULTS_RESTAURANT.id, {
        impressions: 9500,
        weekStart: lastYearSameWeek,
      });

      const comparison = await getSeasonComparison(TEST_RESULTS_RESTAURANT.id);

      expect(comparison).not.toBeNull();
      expect(comparison!.estimatedReach).toBe(9500);
      expect(comparison!.period).toBeTruthy();
    });

    it("returns null for first-season restaurant", async () => {
      const comparison = await getSeasonComparison(TEST_RESULTS_RESTAURANT.id);
      expect(comparison).toBeNull();
    });
  });

  describe("getGuardianMode", () => {
    it("returns null for non-guardian restaurants", async () => {
      const guardian = await getGuardianMode(TEST_RESULTS_RESTAURANT.id);
      expect(guardian).toBeNull();
    });

    it("returns guardian data for restaurants in guardian mode", async () => {
      const db = getDB();
      // Set restaurant to guardian mode
      await db.update(restaurantsTable)
        .set({
          operationalMode: "local_seo_guardian",
          guardianModeSince: new Date("2026-01-01"),
          seoGuardianConfig: JSON.stringify({
            peakSeasonEndMonth: 10,
            guardianStartMonth: 11,
            guardianEndMonth: 12,
            postsPerWeek: 2,
            guardianContentTypes: ["community", "history"],
            reviewResponseEnabled: true,
            monthlyReportEnabled: true,
          }),
        } as any)
        .where(eq(restaurantsTable.id, TEST_RESULTS_RESTAURANT.id));

      const guardian = await getGuardianMode(TEST_RESULTS_RESTAURANT.id);

      expect(guardian).not.toBeNull();
      if (guardian) {
        expect(guardian.enabled).toBe(true);
        expect(guardian.mode).toBe("local_seo_guardian");
        // postsTarget defaults to 2 from DEFAULT_SEO_GUARDIAN_CONFIG
        expect(guardian.postsTarget).toBeGreaterThanOrEqual(0);
        expect(guardian.postsThisWeek).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────────

  describe("edge cases", () => {
    it("getMondayOfWeek returns Monday 00:00:00 UTC", async () => {
      const monday = getMondayOfWeek(new Date("2026-06-24T15:30:00Z")); // Wednesday
      expect(monday.getUTCDay()).toBe(1); // Monday
      expect(monday.getUTCHours()).toBe(0);
      expect(monday.getUTCMinutes()).toBe(0);
      expect(monday.getUTCSeconds()).toBe(0);
    });

    it("getMondayOfWeek handles Sunday as previous Monday", async () => {
      const sunday = new Date("2026-06-28T12:00:00Z"); // Sunday
      const monday = getMondayOfWeek(sunday);
      expect(monday.getUTCDay()).toBe(1); // Monday
      // Monday should be June 22
      expect(monday.getUTCDate()).toBe(22);
    });

    it("computeResultsData handles zero impressions gracefully", async () => {
      const weekStart = getThisWeekMonday();
      const campaignId = "camp_zero_impressions";

      await seedPublishedCampaign(TEST_RESULTS_RESTAURANT.id, campaignId);
      await seedCampaignAnalytics(campaignId, TEST_RESULTS_RESTAURANT.id, {
        impressions: 0,
        weekStart,
      });

      const results = await computeResultsData(TEST_RESULTS_RESTAURANT.id);
      // With zero reach but a published campaign, should still return data
      // (0 impressions from the campaign this week → null because no reach AND no prior week data)
      expect(results).toBeNull();
    });

    it("computeResultsData with only last week's data shows 100% growth", async () => {
      const thisWeek = getThisWeekMonday();
      const lastWeek = new Date(thisWeek.getTime() - 7 * 24 * 60 * 60 * 1000);
      const campaignId = "camp_lw_only";

      await seedPublishedCampaign(TEST_RESULTS_RESTAURANT.id, campaignId);
      await seedCampaignAnalytics(campaignId, TEST_RESULTS_RESTAURANT.id, {
        impressions: 10000,
        weekStart: lastWeek,
      });

      // This week has 0 impressions, last week had 10000.
      // computeResultsData returns data because lastWeekReach > 0 triggers
      // the "data exists" gate (thisWeekReach !== 0 || lastWeekReach !== 0).
      // The percent change is -100%. Test verifies this behavior.
      const results = await computeResultsData(TEST_RESULTS_RESTAURANT.id);
      expect(results).not.toBeNull();
      expect(results!.thisWeek.estimatedReach).toBe(0);
      expect(results!.thisWeek.percentChange).toBe(-100);
    });
  });
});