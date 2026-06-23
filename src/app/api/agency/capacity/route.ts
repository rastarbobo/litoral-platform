import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/utils/auth";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";

/**
 * GET /api/agency/capacity
 *
 * Internal endpoint. Returns the current global Agency Tier capacity state.
 * Auth-gated via Better Auth session cookie.
 *
 * Returns JSend: { status: "success", data: { agencyCount, maxAgency, isAvailable } }
 */

export async function GET(_request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json(
      { status: "error", message: "Not authenticated" },
      { status: 401 },
    );
  }

  const capacity = await restaurantRepo.getAgencyCapacityState();

  return NextResponse.json(
    { status: "success", data: capacity },
    {
      headers: {
        "Cache-Control": "private, max-age=30",
      },
    },
  );
}