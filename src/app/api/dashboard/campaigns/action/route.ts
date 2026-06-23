import { NextRequest, NextResponse } from "next/server";
import { campaignRepo } from "@/db/repositories/campaign-repository";
import { validateDashboardApiAuth } from "@/lib/dashboard/api-auth";
import type { CampaignActionRequest } from "@/lib/dashboard/types";

/**
 * POST /api/dashboard/campaigns/action
 *
 * Performs a campaign management action (approve, reject, request_revision).
 *
 * Request body: { campaignId, action, revisionInstructions?, rejectReason? }
 * Response: JSend { status: "success", data: { campaign: { ... } } }
 *
 * All operations are idempotent — re-submitting the same action on an
 * already-transitioned campaign returns success with no state change.
 */
export async function POST(req: NextRequest) {
  // 1. Auth
  const authenticatedId = await validateDashboardApiAuth(req);
  if (!authenticatedId) {
    return NextResponse.json(
      { status: "error", message: "Unauthorized. Please re-authenticate from Telegram." },
      { status: 401 },
    );
  }

  // 2. Parse body
  let body: CampaignActionRequest;
  try {
    body = (await req.json()) as CampaignActionRequest;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { campaignId, action, revisionInstructions, rejectReason } = body;

  if (!campaignId || !action) {
    return NextResponse.json(
      { status: "error", message: "Missing required fields: campaignId, action" },
      { status: 400 },
    );
  }

  // 3. Verify campaign exists and belongs to this restaurant
  const existing = await campaignRepo.findById(campaignId);
  if (existing.type !== "SUCCESS") {
    return NextResponse.json(
      { status: "error", message: "Campaign not found" },
      { status: 404 },
    );
  }

  if (existing.campaign.restaurantId !== authenticatedId) {
    return NextResponse.json(
      { status: "error", message: "Unauthorized — this campaign does not belong to your account" },
      { status: 403 },
    );
  }

  // 4. Route to appropriate action
  try {
    switch (action) {
      case "approve": {
        // Idempotent: already approved/scheduled/published → success
        if (["approved", "pending_schedule", "scheduled", "published"].includes(existing.campaign.status)) {
          return NextResponse.json({
            status: "success",
            data: {
              campaign: {
                id: campaignId,
                status: existing.campaign.status,
                approvedAt: existing.campaign.approvedAt?.toISOString() ?? null,
                rejectedAt: null,
              },
            },
          });
        }

        const result = await campaignRepo.approve(campaignId);
        if (result.type !== "SUCCESS") {
          return NextResponse.json(
            { status: "error", message: result.message ?? "Failed to approve campaign" },
            { status: 500 },
          );
        }

        return NextResponse.json({
          status: "success",
          data: {
            campaign: {
              id: campaignId,
              status: result.campaign.status,
              approvedAt: result.campaign.approvedAt?.toISOString() ?? null,
              rejectedAt: null,
            },
          },
        });
      }

      case "reject": {
        // Idempotent: already rejected → success
        if (existing.campaign.status === "rejected") {
          return NextResponse.json({
            status: "success",
            data: {
              campaign: {
                id: campaignId,
                status: "rejected",
                approvedAt: null,
                rejectedAt: existing.campaign.rejectedAt?.toISOString() ?? null,
              },
            },
          });
        }

        const result = await campaignRepo.reject(campaignId);
        if (result.type !== "SUCCESS") {
          return NextResponse.json(
            { status: "error", message: result.message ?? "Failed to reject campaign" },
            { status: 500 },
          );
        }

        // Optionally store reject reason in analytics metadata (non-blocking)
        if (rejectReason) {
          try {
            const { analyticsEventsTable } = await import("@/db/schema");
            const { getDB } = await import("@/db");
            await getDB().insert(analyticsEventsTable).values({
              eventType: "campaign_rejected_reason",
              prospectId: authenticatedId,
              metadata: JSON.stringify({
                campaignId,
                reason: rejectReason,
                rejectedAt: new Date().toISOString(),
              }),
            }).execute().catch(() => {
              // Non-critical — don't fail the main flow
            });
          } catch {
            // Non-critical
          }
        }

        return NextResponse.json({
          status: "success",
          data: {
            campaign: {
              id: campaignId,
              status: result.campaign.status,
              approvedAt: null,
              rejectedAt: result.campaign.rejectedAt?.toISOString() ?? null,
            },
          },
        });
      }

      case "request_revision": {
        // Idempotent: already in revision → success
        if (existing.campaign.status === "pending_revision") {
          return NextResponse.json({
            status: "success",
            data: {
              campaign: {
                id: campaignId,
                status: "pending_revision",
                approvedAt: null,
                rejectedAt: null,
              },
            },
          });
        }

        const result = await campaignRepo.requestRevision(campaignId);
        if (result.type !== "SUCCESS") {
          return NextResponse.json(
            { status: "error", message: result.message ?? "Failed to request revision" },
            { status: 500 },
          );
        }

        // Store revision instructions on the campaign record for n8n to pick up.
        // We use the campaign's signalsTriggerHash field temporarily, or write to a
        // dedicated field if one exists. For now, we'll store in a KV key so n8n can
        // pick it up during the revision processing workflow.
        if (revisionInstructions) {
          try {
            const { env } = await import("cloudflare:workers");
            if (env.OPT_OUT_KV) {
              await env.OPT_OUT_KV.put(
                `revision_instructions:${campaignId}`,
                revisionInstructions,
                { expirationTtl: 3600 }, // 1 hour TTL
              );
            }
          } catch {
            // Non-critical
          }
        }

        return NextResponse.json({
          status: "success",
          data: {
            campaign: {
              id: campaignId,
              status: result.campaign.status,
              approvedAt: null,
              rejectedAt: null,
            },
          },
        });
      }

      default:
        return NextResponse.json(
          { status: "error", message: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error("Campaign action error:", err);
    return NextResponse.json(
      {
        status: "error",
        message: err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}