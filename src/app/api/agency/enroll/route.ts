import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/utils/auth";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { AgencyEnrollmentSchema, AGENCY_CAPACITY_MESSAGE } from "@/lib/agency/types";

/**
 * POST /api/agency/enroll
 *
 * Enrolls a restaurant in the Agency Tier. Both global and per-area
 * scarcity checks are performed atomically inside `checkAgencyCapacityAndEnroll`.
 * The route also validates per-area scarcity BEFORE the atomic enrollment
 * to provide a clear error message to the user.
 *
 * Auth-gated. Invite link validation is handled separately by the magic link
 * flow (Story 3.1).
 */

export async function POST(request: NextRequest) {
  // 1. Auth check
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json(
      { status: "error", message: "Not authenticated" },
      { status: 401 },
    );
  }

  // 2. Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parseResult = AgencyEnrollmentSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { status: "fail", data: { validation: parseResult.error.flatten() } },
      { status: 400 },
    );
  }

  const { restaurantId } = parseResult.data;

  // 3. Load restaurant
  const restaurant = await restaurantRepo.findById(restaurantId);
  if (!restaurant) {
    return NextResponse.json(
      { status: "error", message: "Restaurant not found" },
      { status: 404 },
    );
  }

  // 4. Validate required fields for per-area scarcity check
  const cuisineType = restaurant.cuisineType;
  const locationArea = restaurant.locationArea;

  if (!cuisineType || !locationArea) {
    return NextResponse.json(
      { status: "error", message: "Restaurant is missing required cuisine type or location area. Cannot enroll." },
      { status: 400 },
    );
  }

  // 5. Per-area Agency scarcity check (≤ 1 per cuisine/area)
  //    This is an advisory check for a clear error message. The atomic
  //    check inside checkAgencyCapacityAndEnroll is the actual guard.
  const scarcity = await restaurantRepo.getScarcityForCuisineArea(cuisineType, locationArea);
  if (scarcity.agencyCount >= scarcity.maxAgency) {
    return NextResponse.json(
      {
        status: "error",
        message: `Agency Tier slot for ${cuisineType} in ${locationArea} is already taken. Only 1 Agency client per town is allowed.`,
      },
      { status: 409 },
    );
  }

  // 6. Perform the actual atomic enrollment (global cap + state transition)
  const enrollResult = await restaurantRepo.checkAgencyCapacityAndEnroll(restaurantId);

  switch (enrollResult.type) {
    case "SUCCESS": {
      return NextResponse.json({
        status: "success",
        data: { enrolled: true },
      });
    }

    case "AGENCY_CAPACITY_FULL": {
      return NextResponse.json(
        {
          status: "error",
          message: AGENCY_CAPACITY_MESSAGE,
          data: { agencyCount: enrollResult.agencyCount },
        },
        { status: 409 },
      );
    }

    case "ALREADY_ENROLLED": {
      return NextResponse.json({
        status: "success",
        data: { enrolled: false, message: "Restaurant is already enrolled in the Agency Tier" },
      });
    }

    case "NOT_FOUND": {
      return NextResponse.json(
        { status: "error", message: "Restaurant not found or not eligible for enrollment" },
        { status: 404 },
      );
    }

    case "DATABASE_ERROR": {
      return NextResponse.json(
        { status: "error", message: enrollResult.message },
        { status: 500 },
      );
    }

    default: {
      return NextResponse.json(
        { status: "error", message: "Unknown enrollment error" },
        { status: 500 },
      );
    }
  }
}
