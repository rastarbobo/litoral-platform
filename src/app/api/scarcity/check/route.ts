import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/utils/with-rate-limit";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { ScarcityCheckParamsSchema } from "@/lib/scarcity/types";

/**
 * GET /api/scarcity/check?cuisineType=...&locationArea=...
 *
 * Public endpoint. Returns the current scarcity state for a cuisine/area
 * combination. Used by the landing page (Story 2.5/2.6) to display
 * the One Per Town scarcity signal.
 *
 * Cache: 60-second CDN edge cache (Cache-Control: public, max-age=60).
 *
 * Returns JSend: { status: "success", data: { saasCount, agencyCount, maxSaas, maxAgency, isAvailable } }
 */

export async function GET(request: NextRequest) {
  return withRateLimit(
    async () => {
      const { searchParams } = new URL(request.url);
      const rawParams = {
        cuisineType: searchParams.get("cuisineType")?.trim() ?? "",
        locationArea: searchParams.get("locationArea")?.trim() ?? "",
      };

      const parsed = ScarcityCheckParamsSchema.safeParse(rawParams);
      if (!parsed.success) {
        return NextResponse.json(
          { status: "error", message: "Invalid query parameters" },
          {
            status: 400,
            headers: { "Cache-Control": "no-cache" },
          },
        );
      }

      const { cuisineType, locationArea } = parsed.data;
      const scarcity = await restaurantRepo.getScarcityForCuisineArea(cuisineType, locationArea);

      return NextResponse.json(
        { status: "success", data: scarcity },
        {
          headers: {
            "Cache-Control": "public, max-age=60, s-maxage=60",
          },
        },
      );
    },
    {
      identifier: "scarcity-check",
      limit: 100,
      windowInSeconds: 60,
    }
  );
}