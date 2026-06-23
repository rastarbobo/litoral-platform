import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getDB } from "@/db";
import { restaurantsTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { campaignRepo } from "@/db/repositories/campaign-repository";
import { CampaignDetailView } from "@/components/dashboard/campaign-detail-view";
import type { Campaign } from "@/db/schema";

interface PageParams {
  campaignId: string;
}

/**
 * Campaign Detail Page — SSR with multi-tenant authorization.
 *
 * Route: /dashboard/campaign/[campaignId]
 *
 * Fetches the campaign server-side using CampaignRepository.
 * Authorizes by verifying the session cookie's restaurantId matches
 * the campaign's restaurant_id.
 */
export default async function CampaignDetailPage({ params }: { params: Promise<PageParams> }) {
  const { campaignId } = await params;

  if (!campaignId) {
    notFound();
  }

  // Authorize: verify the current session owns this campaign
  const sessionRestaurantId = await getSessionRestaurantId();
  if (!sessionRestaurantId) {
    redirect("/dashboard");
  }

  const raw = await campaignRepo.findById(campaignId);

  if (!raw) {
    notFound();
  }

  // Type-safe extraction of campaign data from discriminated union
  let campaign: Campaign & { restaurantName?: string | null; telegramChatId?: string | null };

  if ("type" in raw && raw.type === "SUCCESS") {
    campaign = raw.campaign;
  } else if ("type" in raw) {
    notFound();
  } else {
    // Already a campaign (direct return from findById in some cases)
    campaign = raw as Campaign & { restaurantName?: string | null; telegramChatId?: string | null };
  }

  // Multi-tenant check: ensure this campaign belongs to the authenticated restaurant
  if (campaign.restaurantId !== sessionRestaurantId) {
    notFound(); // Don't reveal campaign exists; 404 instead of 403
  }

  // Build status history for the timeline
  const statusHistory = buildStatusHistory(campaign);

  // Determine if original/revised caption tabs are needed
  const hasRevision = (campaign.revisionCount ?? 0) > 0;

  return (
    <CampaignDetailView
      campaign={campaign}
      statusHistory={statusHistory}
      hasRevision={hasRevision}
    />
  );
}

// ─── Helpers ───────────────────────────────────────────

interface StatusHistoryEntry {
  status: string;
  label: string;
  date: Date | null;
  isComplete: boolean;
}

function buildStatusHistory(campaign: Campaign & { restaurantName?: string | null }): StatusHistoryEntry[] {
  if (!campaign) return [];

  return [
    { status: "pending", label: "Pending", date: campaign.createdAt, isComplete: true },
    { status: "approved", label: "Approved", date: campaign.approvedAt ?? null, isComplete: !!campaign.approvedAt },
    { status: "scheduled", label: "Scheduled", date: campaign.approvedAt ?? null, isComplete: campaign.status === "scheduled" || campaign.status === "published" },
    { status: "published", label: "Published", date: null, isComplete: campaign.status === "published" },
  ];
}

// ─── Session Authorization ─────────────────────────────

async function getSessionRestaurantId(): Promise<string | null> {
  try {
    const c = await cookies();
    const sessionCookie = c.get("litoral_dashboard_session");

    if (!sessionCookie) return null;

    const session = JSON.parse(sessionCookie.value) as { restaurantId?: string };
    if (!session.restaurantId) return null;

    // Light validation: ensure restaurant still exists
    const db = getDB();
    const row = await db
      .select({ id: restaurantsTable.id })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.id, session.restaurantId));

    if (!row || row.length === 0) return null;

    return session.restaurantId;
  } catch {
    return null;
  }
}
