import { NextRequest, NextResponse } from "next/server";
import { campaignRepo } from "@/db/repositories/campaign-repository";
import { validateDashboardApiAuth } from "@/lib/dashboard/api-auth";
import { CAMPAIGN_STATUS } from "@/db/schema";

const VALID_STATUSES = new Set<string>(Object.values(CAMPAIGN_STATUS));

/**
 * PATCH /api/dashboard/campaigns/[campaignId]/status
 *
 * Updates the status of a single campaign.
 *
 * Request body: { status: string }
 * Response: JSend { status: "success", data: { campaign: { ... } } }
 *
 * Auth: restaurant must own the campaign.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;

  // 1. Auth
  const authenticatedId = await validateDashboardApiAuth(req);
  if (!authenticatedId) {
    return NextResponse.json(
      { status: "error", message: "Unauthorized" },
      { status: 401 },
    );
  }

  // 2. Parse body
  let newStatus: string;
  try {
    const body = (await req.json()) as { status?: string };
    const rawStatus = body.status ?? "";
    if (!VALID_STATUSES.has(rawStatus)) {
      return NextResponse.json(
        {
          status: "error",
          message: `Invalid status: ${rawStatus}. Valid: ${[...VALID_STATUSES].join(", ")}`,
        },
        { status: 400 },
      );
    }
    newStatus = rawStatus;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body" },
      { status: 400 },
  ) 
  }

  // 3. Verify ownership
  const existing = await campaignRepo.findById(campaignId);
  if (existing.type !== "SUCCESS") {
    return NextResponse.json(
      { status: "error", message: "Campaign not found" },
      { status: 404 },
    );
  }

  if (existing.campaign.restaurantId !== authenticatedId) {
    return NextResponse.json(
      { status: "error", message: "Unauthorized" },
      { status: 403 },
    );
  }

  // 4. Update status
  const result = await campaignRepo.updateStatus(campaignId, newStatus);
  if (result.type !== "SUCCESS") {
    return NextResponse.json(
      { status: "error", message: result.message ?? "Failed to update status" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    status: "success",
    data: {
      campaign: {
        id: campaignId,
        status: result.campaign.status,
      },
    },
  });
}