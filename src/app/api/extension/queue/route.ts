import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDB } from "@/db";
import { restaurantsTable } from "@/db/schema";
import { campaignRepo } from "@/db/repositories/campaign-repository";
import { tryCatch } from "@/lib/try-catch";
import { getR2AssetUrl } from "@/lib/r2/asset-url";

/**
 * GET /api/extension/queue
 *
 * Returns approved campaigns ready for scheduling by the Chrome Extension.
 * Auth: Bearer token from restaurants.extension_auth_token.
 * JSend format.
 *
 * Does NOT transition campaign state — claimForScheduling() handles that.
 */
export async function GET(req: NextRequest) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return NextResponse.json(
      { status: "error", message: "Missing Bearer token" },
      { status: 401 },
    );
  }

  // Resolve restaurant from extension auth token
  const db = getDB();
  const { data: restaurant } = await tryCatch(
    db.query.restaurantsTable.findFirst({
      where: eq(restaurantsTable.extensionAuthToken, token),
    }),
  );

  if (!restaurant) {
    return NextResponse.json(
      { status: "error", message: "Invalid or expired token" },
      { status: 401 },
    );
  }

  // Story 7.5: Skip hibernate restaurants — no campaigns for paused subscriptions
  if (restaurant.subscriptionStatus === "hibernate") {
    return NextResponse.json(
      {
        status: "success",
        data: [],
        message: "Subscription is paused — no campaigns available",
      },
      { status: 200 },
    );
  }

  // Fetch approved campaigns
  const campaigns = await campaignRepo.listApproved(restaurant.id);

  // Map to payloads with signed R2 URLs (24h expiry)
  const payloads = await Promise.all(
    campaigns.map(async (c) => ({
      campaignId: c.id,
      restaurantId: c.restaurantId,
      platform: c.platforms,
      assetUrl: c.assetR2Key ? await getR2AssetUrl(c.assetR2Key, 24) : null,
      caption: c.caption,
      scheduledTime: c.scheduledAt?.toISOString() ?? null,
      mediaType: c.fullAssetR2Key ? "video" : "image",
    })),
  );

  return NextResponse.json({
    status: "success",
    data: { campaigns: payloads },
  });
}