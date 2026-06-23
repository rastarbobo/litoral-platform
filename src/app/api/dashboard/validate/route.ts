import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/db";
import { restaurantsTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { tryCatch } from "@/lib/try-catch";
import { sha256Hash } from "@/lib/onboarding/tokens"; // Reuse existing SHA-256 hash util

/**
 * POST /api/dashboard/validate
 *
 * Validates a dashboard magic link token.
 * Reuses the token validation pattern from Story 3.1.
 *
 * Request body: { restaurantId: string, token: string }
 * On success: returns JSend success
 * On failure: returns JSend error
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { restaurantId?: string; token?: string };
    const { restaurantId, token } = body;

    if (!restaurantId || !token) {
      return NextResponse.json(
        { status: "error", message: "Missing restaurantId or token" },
        { status: 400 }
      );
    }

    const db = getDB();

    // Step 2: Validate token hash against the restaurant record
    // Following Story 3.1 pattern: hash the incoming token and compare
    const incomingHash = await sha256Hash(token);

    const { data: restaurant, error } = await tryCatch(
      db.select({
        id: restaurantsTable.id,
        name: restaurantsTable.name,
        magicLinkTokenHash: restaurantsTable.magicLinkTokenHash,
        magicLinkExpiresAt: restaurantsTable.magicLinkExpiresAt,
      }).from(restaurantsTable).where(eq(restaurantsTable.id, restaurantId))
    );

    if (error || !restaurant || restaurant.length === 0) {
      return NextResponse.json(
        { status: "error", message: "Invalid or expired link" },
        { status: 401 }
      );
    }

    const row = restaurant[0];

    // Verify token hash matches
    if (row.magicLinkTokenHash !== incomingHash) {
      return NextResponse.json(
        { status: "error", message: "Invalid or expired link" },
        { status: 401 }
      );
    }

    // Check token hasn't expired
    if (row.magicLinkExpiresAt && new Date() > new Date(row.magicLinkExpiresAt)) {
      return NextResponse.json(
        { status: "error", message: "Link has expired. Request a new one from Telegram." },
        { status: 401 }
      );
    }

    return NextResponse.json({
      status: "success",
      data: { restaurantId, name: restaurant[0].name },
    });
  } catch (err) {
    console.error("Dashboard validate error:", err);
    return NextResponse.json(
      { status: "error", message: "Internal server error" },
      { status: 500 }
    );
  }
}
