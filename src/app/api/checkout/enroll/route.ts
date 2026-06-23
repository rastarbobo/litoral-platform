import { NextRequest, NextResponse } from "next/server";
import { env as workerEnv } from "cloudflare:workers";
import { getSessionFromCookie } from "@/utils/auth";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { EnrollmentRequestSchema } from "@/lib/scarcity/types";

/**
 * POST /api/checkout/enroll
 *
 * Bridges checkout → scarcity enforcement. Validates the restaurant, performs
 * the atomic scarcity check and enrollment, and returns the result.
 *
 * Auth-gated via Better Auth session cookie.
 *
 * Body (JSON):
 *   restaurantId: string   — restaurant to enroll
 *   tier: "saas" | "agency" — subscription tier
 *
 * Returns JSend: { status: "success", data: { enrolled: true } }
 *            or: { status: "error", message: "scarcity full / already enrolled / etc." }
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

  // 2. Parse & validate body with Zod
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parseResult = EnrollmentRequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return NextResponse.json(
      { status: "error", message: "Invalid request body" },
      { status: 400 },
    );
  }

  const { restaurantId, tier } = parseResult.data;

  // 3. Load restaurant to get cuisineType and locationArea
  const restaurant = await restaurantRepo.findById(restaurantId);
  if (!restaurant) {
    return NextResponse.json(
      { status: "error", message: "Restaurant not found" },
      { status: 404 },
    );
  }

  const cuisineType = restaurant.cuisineType;
  const locationArea = restaurant.locationArea;

  if (!cuisineType || !locationArea) {
    return NextResponse.json(
      { status: "error", message: "Restaurant missing cuisine type or location area. Cannot enforce scarcity." },
      { status: 400 },
    );
  }

  // 4. Scarcity check and enrollment
  const result = await restaurantRepo.checkScarcityAndEnroll(
    restaurantId,
    cuisineType,
    locationArea,
    tier,
  );

  switch (result.type) {
    case "SUCCESS": {
      // Enqueue competitor-activation event if this SaaS enrollment filled the 2nd slot.
      // The repository tells us directly — no second query, no race.
      const competitorQueue = (workerEnv as unknown as Record<string, unknown>).COMPETITOR_ACTIVATED_QUEUE as Queue | undefined;
      if (result.triggeredCompetitorActivation && competitorQueue) {
        competitorQueue.send(JSON.stringify({
          event: "competitor_activated",
          restaurantId,
          cuisineType,
          locationArea,
          timestamp: new Date().toISOString(),
        })).catch((err) => {
          console.error("Competitor activation queue send failed", { error: err, restaurantId });
        });
      }

      return NextResponse.json({
        status: "success",
        data: { enrolled: true, tier, triggeredCompetitorActivation: result.triggeredCompetitorActivation },
      });
    }

    case "SCARCITY_FULL": {
      return NextResponse.json(
        {
          status: "error",
          message: `Sorry, the One Per Town limit has been reached for ${cuisineType} cuisine in ${locationArea}. Only 2 SaaS and 1 Agency clients per town are accepted to maintain our exclusivity promise.`,
          data: {
            saasCount: result.saasCount,
            agencyCount: result.agencyCount,
          },
        },
        { status: 409 },
      );
    }

    case "ALREADY_ENROLLED": {
      return NextResponse.json({
        status: "success",
        data: { enrolled: false, message: "Restaurant is already enrolled" },
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
        { status: "error", message: result.message },
        { status: 500 },
      );
    }

    default:
      return NextResponse.json(
        { status: "error", message: "Unknown enrollment error" },
        { status: 500 },
      );
  }
}