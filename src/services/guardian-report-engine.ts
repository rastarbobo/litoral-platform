/**
 * Guardian Report Engine — Story 7.3 (Task 4.1)
 *
 * Computes the Monthly SEO Guardianship Report for restaurants
 * in Local SEO Guardian mode. Shows ranking stability, review coverage,
 * and estimated ranking decay avoided.
 */

import { eq, and, gte, sql } from "drizzle-orm";
import { getDB } from "@/db";
import {
  restaurantsTable,
  campaignsTable,
  guardianReportsTable,
  DEFAULT_SEO_GUARDIAN_CONFIG,
} from "@/db/schema";
import type {
  GuardianReport,
  ReviewCoverage,
  GuardianReportData,
  SeoGuardianConfig,
} from "@/db/schema";
import { reviewResponsesRepo } from "@/db/repositories/review-responses-repository";
import { tryCatch } from "@/lib/try-catch";

// ─── Types ────────────────────────────────────────────────

export type { GuardianReportData, ReviewCoverage };

// ─── Core Computation ────────────────────────────────────

/**
 * Generate the monthly guardian report for a restaurant.
 *
 * @param restaurantId - The restaurant to generate a report for
 * @returns GuardianReportData or null if not enough data
 */
export async function generateMonthlyGuardianReport(
  restaurantId: string,
): Promise<GuardianReportData | null> {
  const db = getDB();

  // 1. Get the restaurant's guardian config and mode info
  const { data: rows } = await tryCatch(
    db
      .select({
        guardianModeSince: restaurantsTable.guardianModeSince,
        googleRating: restaurantsTable.googleRating,
        googleMapsData: restaurantsTable.googleMapsData,
        seoGuardianConfig: restaurantsTable.seoGuardianConfig,
      })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.id, restaurantId)),
  );

  const restaurant = rows?.[0];
  if (!restaurant || !restaurant.guardianModeSince) {
    // Not in guardian mode, return zero-stat report per spec AC 6.9
    const now = new Date();
    return {
      month: now.getFullYear() * 100 + (now.getMonth() + 1),
      rankingStability: "stable",
      reviewCoverage: { drafted: 0, approved: 0, published: 0, total: 0 },
      decayAvoided: "Not yet in guardian mode — no maintenance activity to report.",
      postsPublished: 0,
    };
  }

  const config: SeoGuardianConfig = (restaurant.seoGuardianConfig as SeoGuardianConfig) ?? DEFAULT_SEO_GUARDIAN_CONFIG;

  // 2. Date range: last 30 days (monthly report window)
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const guardianSince = new Date(restaurant.guardianModeSince as number);

  // Use the later of 30 days ago or guardian mode start
  const reportStart = guardianSince > thirtyDaysAgo ? guardianSince : thirtyDaysAgo;

  // 3. Count guardian posts published in the window
  const { data: postsData } = await tryCatch(
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(campaignsTable)
      .where(
        and(
          eq(campaignsTable.restaurantId, restaurantId),
          eq(campaignsTable.campaignType, "guardian"),
          eq(campaignsTable.status, "published"),
          gte(sql`created_at`, reportStart.getTime()),
        ),
      ),
  );

  const postsPublished = postsData?.[0]?.count as number ?? 0;

  // 4. Review coverage stats from reviewResponsesRepo
  const reviewCoverage = await reviewResponsesRepo.getReviewCoverage(
    restaurantId,
    reportStart,
  );

  // 5. Ranking stability assessment
  const rankingStability = await assessRankingStability(restaurantId, restaurant.googleMapsData as Record<string, unknown> | null);

  // 6. Estimated decay avoided
  const decayAvoided = estimateDecayAvoided(postsPublished, config.postsPerWeek ?? 2);

  // 7. Current month in YYYYMM format
  const month = now.getFullYear() * 100 + (now.getMonth() + 1);

  return {
    month,
    rankingStability,
    reviewCoverage,
    decayAvoided,
    postsPublished,
  };
}

// ─── Ranking Stability Assessment ────────────────────────

type StabilityLevel = "stable" | "slight_decline" | "significant_decline";

/**
 * Assess ranking stability by comparing current googleMapsData to the
 * baseline captured at the start of guardian mode.
 *
 * Simplified heuristic: if no ranking data available, assume stable.
 * In production, this should compare Google Maps ranking position
 * and review count/rating trends over the guardian period.
 */
async function assessRankingStability(
  restaurantId: string,
  googleMapsData: Record<string, unknown> | null,
): Promise<StabilityLevel> {
  // If no ranking data available, assume stable
  if (!googleMapsData) {
    return "stable";
  }

  // Check for ranking data in the stored JSON
  const rank = googleMapsData["rank"] as number | undefined;
  const previousRank = googleMapsData["previousRank"] as number | undefined;

  if (rank === undefined || previousRank === undefined) {
    return "stable";
  }

  // A rank increase means worse position (e.g., 3 → 5 is a decline)
  const rankChange = rank - previousRank;

  if (rankChange <= 0) {
    return "stable"; // Maintained or improved
  } else if (rankChange <= 3) {
    return "slight_decline";
  } else {
    return "significant_decline";
  }
}

// ─── Decay Avoidance Estimation ──────────────────────────

/**
 * Estimate the ranking decay avoided by staying active vs. going dark.
 *
 * Simplified model: each guardian-mode post maintains visibility
 * equivalent to ~15% of a peak-season post. Going completely dark
 * for the off-season typically causes 30-50% ranking loss.
 * Staying active with guardian posts reduces that to ~10-20%.
 *
 * @param postsPublished - Number of guardian posts published this month
 * @param postsPerWeek - Target posts per week from config
 * @returns Human-readable description of decay avoided
 */
function estimateDecayAvoided(postsPublished: number, postsPerWeek: number): string {
  const expectedMonthlyPosts = postsPerWeek * 4; // ~4 weeks/month

  if (postsPublished === 0) {
    return "No guardian posts published this month — rankings may be declining. Consider ramping up to the target cadence.";
  }

  const coverageRatio = postsPublished / expectedMonthlyPosts;

  if (coverageRatio >= 0.8) {
    return "Strong maintenance — your Google presence is well-preserved. Estimated ranking decay avoided: ~80-90% vs. going completely dark.";
  } else if (coverageRatio >= 0.5) {
    return "Moderate maintenance — partial ranking preservation. Estimated decay avoided: ~50-70% vs. going dark. Consider increasing post frequency.";
  } else {
    return "Minimal maintenance — your ranking may be eroding. Estimated decay avoided: ~20-40% vs. going dark. Strongly recommended to increase post frequency.";
  }
}

// ─── Report Persistence ──────────────────────────────────

/**
 * Generate and persist a monthly guardian report in D1.
 * Used by the Worker cron on the 1st of each month.
 *
 * @returns The report ID if successful, or null on failure
 */
export async function generateAndPersistReport(
  restaurantId: string,
): Promise<string | null> {
  const report = await generateMonthlyGuardianReport(restaurantId);
  if (!report) return null;

  const db = getDB();
  const now = new Date();

  // Upsert: replace any existing report for the same month
  const { data: result, error } = await tryCatch(
    db
      .insert(guardianReportsTable)
      .values({
        restaurantId,
        reportMonth: report.month,
        rankingStability: report.rankingStability,
        reviewCoverage: report.reviewCoverage,
        decayAvoided: report.decayAvoided,
        postsPublished: report.postsPublished,
        generatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          guardianReportsTable.restaurantId,
          guardianReportsTable.reportMonth,
        ],
        set: {
          rankingStability: report.rankingStability,
          reviewCoverage: report.reviewCoverage,
          decayAvoided: report.decayAvoided,
          postsPublished: report.postsPublished,
          generatedAt: now,
        },
      })
      .returning({ id: guardianReportsTable.id }),
  );

  if (error) {
    console.error("GuardianReportEngine: failed to persist report", {
      error,
      restaurantId,
      month: report.month,
    });
    return null;
  }

  return result?.[0]?.id ?? null;
}

/**
 * Get the most recent guardian report for a restaurant.
 */
export async function getLatestGuardianReport(
  restaurantId: string,
): Promise<GuardianReportData | null> {
  const db = getDB();

  const { data: rows, error } = await tryCatch(
    db
      .select()
      .from(guardianReportsTable)
      .where(eq(guardianReportsTable.restaurantId, restaurantId))
      .orderBy(sql`report_month DESC`)
      .limit(1),
  );

  if (error || !rows || rows.length === 0) return null;

  const report = rows[0];
  return {
    month: report.reportMonth,
    rankingStability: report.rankingStability as GuardianReportData["rankingStability"],
    reviewCoverage: report.reviewCoverage as ReviewCoverage,
    decayAvoided: report.decayAvoided,
    postsPublished: report.postsPublished,
  };
}