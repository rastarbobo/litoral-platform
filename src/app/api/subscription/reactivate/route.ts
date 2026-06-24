import { NextRequest, NextResponse } from "next/server";
import { getDB } from "@/db";
import { restaurantsTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { determineTargetMode } from "@/services/reactivation-engine";

/**
 * POST /api/subscription/reactivate
 *
 * Reactivates a restaurant from Hibernate tier.
 * Determines the correct operational mode based on the current month
 * and atomically transitions the restaurant back to active status.
 *
 * Story 7.5 (AC 8) — owner-initiated reactivation.
 */
export async function POST(req: NextRequest) {
  const { restaurantId } = (await req.json().catch(() => ({}))) as {
    restaurantId?: string;
  };

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
    // 1. Verify restaurant is in hibernate
    const db = getDB();
    const rows = await db
      .select({
        subscriptionStatus: restaurantsTable.subscriptionStatus,
        operationalMode: restaurantsTable.operationalMode,
      })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.id, restaurantId));

    const restaurant = rows?.[0];
    if (
      !restaurant ||
      restaurant.subscriptionStatus !== "hibernate" ||
      restaurant.operationalMode !== "hibernate"
    ) {
      return NextResponse.json(
        {
          status: "error",
          message: "Restaurant is not in hibernate mode",
        },
        { status: 409 },
      );
    }

    // 2. Determine target mode
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const targetMode = determineTargetMode(currentMonth);

    // 3. Atomically reactivate
    const result = await restaurantRepo.reactivateFromHibernate(
      restaurantId,
      targetMode,
    );

    if (result.type === "NO_OP") {
      return NextResponse.json(
        {
          status: "error",
          message: "Restaurant is no longer in hibernate — may have been reactivated by another request",
        },
        { status: 409 },
      );
    }

    if (result.type === "DATABASE_ERROR") {
      return NextResponse.json(
        { status: "error", message: result.message },
        { status: 500 },
      );
    }

    // 4. Restore R2 access
    await restaurantRepo.restoreR2Access(restaurantId);

    return NextResponse.json({
      status: "success",
      data: {
        newMode: targetMode,
        subscriptionStatus: "active_saas",
      },
    });
  } catch (err) {
    console.error("Reactivation API: failed", { error: err, restaurantId });
    return NextResponse.json(
      { status: "error", message: "Failed to reactivate subscription" },
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
    return session?.restaurantId ?? null;
  } catch {
    return null;
  }
}