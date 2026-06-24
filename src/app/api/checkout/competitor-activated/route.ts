import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@/utils/cloudflare-context";

/**
 * POST /api/checkout/competitor-activated
 *
 * Internal endpoint called (fire-and-forget) when the second SaaS client
 * in a cuisine/area combo successfully enrolls. Triggers competitor
 * activation retargeting for non-converting prospects in that area.
 *
 * This uses the existing `processCompetitorSignup` function from the
 * retargeting scheduler (Story 2.9), which handles prospect lookup,
 * event logging, and n8n webhook firing.
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { restaurantId?: string };

    if (!body.restaurantId || typeof body.restaurantId !== "string") {
      return NextResponse.json(
        { status: "fail", data: { message: "Missing restaurantId" } },
        { status: 400 },
      );
    }

    // Delegate to the existing retargeting scheduler
    const { env } = await getCloudflareContext();
    const { processCompetitorSignup } = await import("@/lib/scheduler/retargeting-scheduler");

    const processedCount = await processCompetitorSignup(env as unknown as Record<string, unknown>, body.restaurantId);

    if (processedCount < 0) {
      return NextResponse.json(
        { status: "error", message: "Retargeting processing failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      status: "success",
      data: { processedCount },
    });
  } catch (err) {
    console.error("Competitor-activated endpoint error:", err);
    return NextResponse.json(
      { status: "error", message: "Internal error processing competitor activation" },
      { status: 500 },
    );
  }
}