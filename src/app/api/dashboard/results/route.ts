import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/db";
import { restaurantsTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { computeResultsData, getSeasonComparison, getGuardianMode, getGuardianReport, getMondayOfWeek } from "@/services/results-engine";
import { campaignAnalyticsRepo } from "@/db/repositories/campaign-analytics-repository";

/**
 * GET /api/dashboard/results?restaurantId={id}
 *
 * Returns computed ROI analytics for the "One Extra Table" Results Dashboard.
 * JSend format. Story 7.1 — replaces hardcoded mock data with real computation.
 * REQUIRES: Valid session cookie.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const restaurantId = searchParams.get("restaurantId");

  if (!restaurantId) {
    return NextResponse.json(
      { status: "error", message: "Missing restaurantId" },
      { status: 400 },
    );
  }

  // Authorize: ensure request originates from an authenticated session
  const sessionRestaurantId = await getSessionRestaurantId(req);
  if (!sessionRestaurantId || sessionRestaurantId !== restaurantId) {
    return NextResponse.json(
      { status: "error", message: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    // Story 7.5: Check for hibernate mode before computing results
    const db = getDB();
    const statusRows = await db
      .select({
        subscriptionStatus: restaurantsTable.subscriptionStatus,
        operationalMode: restaurantsTable.operationalMode,
        reactivationEligibility: restaurantsTable.reactivationEligibility,
        name: restaurantsTable.name,
      })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.id, restaurantId));

    const restaurantStatus = statusRows?.[0];
    if (
      restaurantStatus?.subscriptionStatus === "hibernate" &&
      restaurantStatus?.operationalMode === "hibernate"
    ) {
      // Return hibernate payload (Story 7.5, AC 6)
      return NextResponse.json({
        status: "success",
        data: {
          mode: "hibernate",
          restaurantName: restaurantStatus.name ?? "Your restaurant",
          reactivationEligibility: restaurantStatus.reactivationEligibility ?? null,
        },
      });
    }

    const results = await computeResultsData(restaurantId);

    if (!results) {
      // No campaigns published yet — return explicit null
      return NextResponse.json({
        status: "success",
        data: null,
      });
    }

    // Add season comparison if available (Story 7.1)
    const seasonComparison = await getSeasonComparison(restaurantId);

    // Add guardian mode and report data (Story 7.3)
    const guardianMode = await getGuardianMode(restaurantId);
    const guardianReport = guardianMode?.enabled
      ? await getGuardianReport(restaurantId)
      : null;

    // Add pre-season booking intent data (Story 7.4)
    const weekStart = getMondayOfWeek(new Date());
    const preSeasonClicks = await campaignAnalyticsRepo.getPreSeasonBookingIntent(
      restaurantId,
      weekStart,
    );
    const preSeasonBooking = { clicks: preSeasonClicks };

    return NextResponse.json({
      status: "success",
      data: {
        ...results,
        seasonComparison,
        guardianMode,
        guardianReport,
        preSeasonBooking,
      },
    });
  } catch (err) {
    console.error("Results API: computation failed", { error: err, restaurantId });
    return NextResponse.json(
      { status: "error", message: "Failed to compute results" },
      { status: 500 },
    );
  }
}

// ─── Session Authorization ─────────────────────────────

async function getSessionRestaurantId(req: NextRequest): Promise<string | null> {
  try {
    const sessionCookie = req.cookies.get("litoral_dashboard_session");
    if (!sessionCookie) return null;

    const session = JSON.parse(sessionCookie.value) as { restaurantId?: string };
    if (!session.restaurantId) return null;

    const db = getDB();
    const row = await db
      .select({ id: restaurantsTable.id })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.id, session.restaurantId));

    if (!row || row.length === 0) return null;

    return session.restaurantId;
  } catch {
    return null;
  }
}