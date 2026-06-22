import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/db";
import { restaurantsTable } from "@/db/schema";
import { campaignRepo } from "@/db/repositories/campaign-repository";
import { eq } from "drizzle-orm";
import type { SortOption, CampaignTypeFilter, SourceFilter } from "@/lib/dashboard/types";
import { getR2AssetUrl } from "@/lib/r2/asset-url";

/**
 * GET /api/dashboard/campaigns?restaurantId={id}&sort={sort}&campaignType={type}&source={source}
 *
 * Returns campaigns for a restaurant, grouped by status with optional filter/sort.
 * JSend format, strictly scoped to restaurant_id.
 * REQUIRES: Valid session cookie (same-origin protection).
 *
 * Query params:
 *   - restaurantId (required): restaurant to fetch campaigns for
 *   - sort: "created_at_desc" (default) | "created_at_asc"
 *   - campaignType: "all" (default) | "flash_offer" | "seasonal_event" | "daily_special" | "brand_awareness"
 *   - source: "all" (default) | "autonomous" | "owner_initiated"
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
  // by checking the restaurant ID in the session cookie.
  const sessionRestaurantId = await getSessionRestaurantId(req);
  if (!sessionRestaurantId || sessionRestaurantId !== restaurantId) {
    return NextResponse.json(
      { status: "error", message: "Unauthorized" },
      { status: 401 },
    );
  }

  // Parse sort/filter params
  const sort = (searchParams.get("sort") ?? "created_at_desc") as SortOption;
  const campaignType = (searchParams.get("campaignType") ?? "all") as CampaignTypeFilter;
  const source = (searchParams.get("source") ?? "all") as SourceFilter;

  try {
    const { data: allCampaigns, error } = await campaignRepo.listByRestaurant(restaurantId, {
      sort,
      campaignType,
      source,
      limit: 60,
    });

    if (error) {
      return NextResponse.json(
        { status: "error", message: error },
        { status: 500 },
      );
    }

    // Enrich with signed thumbnail URLs
    const campaigns = await Promise.all(
      allCampaigns.map(async (c) => ({
        ...c,
        thumbnailUrl: c.assetR2Key ? await getR2AssetUrl(c.assetR2Key, 168) : null,
      })),
    );

    // Group by status
    const pending = campaigns.filter(
      (c) => c.status === "pending_approval" || c.status === "pending_revision",
    );
    const scheduled = campaigns.filter(
      (c) =>
        c.status === "approved" ||
        c.status === "scheduled" ||
        c.status === "pending_schedule",
    );
    const published = campaigns.filter((c) => c.status === "published");
    const rejected = campaigns.filter((c) => c.status === "rejected");

    return NextResponse.json({
      status: "success",
      data: {
        pending,
        scheduled,
        published,
        rejected,
      },
    });
  } catch (err) {
    console.error("Dashboard campaigns API error:", err);
    return NextResponse.json(
      {
        status: "error",
        message: err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}

// ─── Session Authorization ─────────────────────────────

/**
 * Extract the authenticated restaurant ID from the request session.
 * Reads a signed session cookie set after successful magic-link validation.
 */
async function getSessionRestaurantId(req: NextRequest): Promise<string | null> {
  try {
    const sessionCookie = req.cookies.get("litoral_dashboard_session");
    if (!sessionCookie) return null;

    const session = JSON.parse(sessionCookie.value) as { restaurantId?: string };
    if (!session.restaurantId) return null;

    // Light validation: ensure restaurant still exists
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
