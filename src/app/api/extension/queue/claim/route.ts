import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDB } from "@/db";
import { restaurantsTable } from "@/db/schema";
import { campaignRepo } from "@/db/repositories/campaign-repository";
import { tryCatch } from "@/lib/try-catch";

/**
 * POST /api/extension/queue/claim
 *
 * Atomically claims a campaign for scheduling by the Chrome Extension.
 * Transitions approved → pending_schedule with a database-level lock.
 * JSend format.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json(
      { status: "error", message: "Missing Bearer token" },
      { status: 401 },
    );
  }

  const body = await req.json().catch((err) => {
    console.warn("Extension claim: malformed JSON body", { error: err });
    return null;
  }) as Record<string, unknown> | null;
  const campaignId = typeof body?.campaignId === "string" ? body.campaignId : undefined;
  if (!campaignId || typeof campaignId !== "string") {
    return NextResponse.json(
      { status: "fail", data: { campaignId: "Required" } },
      { status: 400 },
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
      { status: "error", message: "Invalid token" },
      { status: 401 },
    );
  }

  // Atomically claim the campaign
  const result = await campaignRepo.claimForScheduling(
    campaignId,
    restaurant.id,
    restaurant.slug ?? undefined,
  );

  if ("type" in result && result.type === "DATABASE_ERROR") {
    return NextResponse.json(
      { status: "error", message: result.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    status: "success",
    data: { claimed: "claimed" in result ? result.claimed : false },
  });
}