import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDB } from "@/db";
import { restaurantsTable } from "@/db/schema";
import { campaignRepo } from "@/db/repositories/campaign-repository";
import { tryCatch } from "@/lib/try-catch";

/**
 * POST /api/extension/queue/scheduled
 *
 * Marks a campaign as scheduled after native UI injection succeeds (Story 6.3).
 * Transitions pending_schedule → scheduled atomically.
 * JSend format.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");

  const body = await req.json().catch((err) => {
    console.warn("Extension scheduled: malformed JSON body", { error: err });
    return null;
  }) as Record<string, unknown> | null;
  const campaignId = typeof body?.campaignId === "string" ? body.campaignId : undefined;
  const scheduledAtStr = typeof body?.scheduledAt === "string" ? body.scheduledAt : undefined;

  if (!campaignId || !scheduledAtStr) {
    return NextResponse.json(
      {
        status: "fail",
        data: {
          campaignId: !campaignId ? "Required" : undefined,
          scheduledAt: !scheduledAtStr ? "Required ISO 8601" : undefined,
        },
      },
      { status: 400 },
    );
  }

  const scheduledAt = new Date(scheduledAtStr);
  if (isNaN(scheduledAt.getTime())) {
    return NextResponse.json(
      { status: "fail", data: { scheduledAt: "Invalid ISO 8601 date" } },
      { status: 400 },
    );
  }

  // Auth check
  const db = getDB();
  const { data: restaurant } = await tryCatch(
    db.query.restaurantsTable.findFirst({
      where: eq(restaurantsTable.extensionAuthToken, token ?? ""),
    }),
  );

  if (!restaurant) {
    return NextResponse.json(
      { status: "error", message: "Unauthorized" },
      { status: 401 },
    );
  }

  const result = await campaignRepo.markAsScheduled(
    campaignId,
    restaurant.id,
    scheduledAt,
  );

  if ("type" in result && result.type === "DATABASE_ERROR") {
    return NextResponse.json(
      { status: "error", message: result.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    status: "success",
    data: { scheduled: "scheduled" in result ? result.scheduled : false },
  });
}