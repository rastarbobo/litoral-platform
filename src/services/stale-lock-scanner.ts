import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { getDB } from "@/db";
import { campaignsTable } from "@/db/schema";
import { tryCatch } from "@/lib/try-catch";
import { sendP1Alert } from "@/services/telegram-alerts";

/**
 * Core stale lock scanner logic.
 *
 * Finds campaigns in 'pending_schedule' state with claimed_at > 20 minutes ago
 * and no scheduled_at set, then reverts them to 'approved' + sends P1 operator alert.
 *
 * Designed to be callable from both the Next.js API cron route and the
 * Cloudflare Worker `scheduled` handler.
 */
interface StaleLockScanResult {
  scannedAt: string;
  staleFound: number;
  reverted: number;
  revertedSlugs: string[];
}



/**
 * Run the stale lock scanner.
 *
 * @returns Summary of the scan and revert operations.
 */
export async function runStaleLockScanner(): Promise<StaleLockScanResult> {
  const db = getDB();
  const STALE_LOCK_MINUTES = 20;
  const staleThreshold = new Date(Date.now() - STALE_LOCK_MINUTES * 60 * 1000);

  // Find stale pending_schedule campaigns
  const { data: staleCampaigns, error } = await tryCatch(
    db.query.campaignsTable.findMany({
      where: and(
        eq(campaignsTable.status, "pending_schedule"),
        isNotNull(campaignsTable.claimedAt),
        lte(campaignsTable.claimedAt, staleThreshold),
        isNull(campaignsTable.scheduledAt),
      ),
    }),
  );

  if (error) {
    console.error("Stale lock scanner: query failed", { error });
    throw new Error("Stale lock scanner query failed");
  }

  let revertedCount = 0;
  const revertedSlugs: string[] = [];

  for (const campaign of staleCampaigns ?? []) {
    // Atomically revert to 'approved' AND increment revertCount
    const { error: revertError } = await tryCatch(
      db
        .update(campaignsTable)
        .set({
          status: "approved",
          claimedAt: null,
          claimedBy: null,
          revertCount: sql`${campaignsTable.revertCount} + 1`,
        })
        .where(
          and(
            eq(campaignsTable.id, campaign.id),
            eq(campaignsTable.status, "pending_schedule"), // Re-verify state hasn't changed
          ),
        )
        .execute(),
    );

    if (revertError) {
      console.error("Stale lock scanner: revert failed", {
        campaignId: campaign.id,
        error: revertError,
      });
      continue;
    }

    revertedCount++;
    if (campaign.claimedBy) {
      revertedSlugs.push(campaign.claimedBy);
    }
  }

  // P1 alert if any campaigns were reverted
  if (revertedCount > 0) {
    await sendP1Alert({
      title: "⚠️ Stale Pending Schedule Locks Reverted",
      body:
        `Reverted ${revertedCount} campaign(s) from pending_schedule → approved.\n` +
        `Restaurants: ${revertedSlugs.join(", ") || "unknown"}\n` +
        `Recommendation: Check extension health for these restaurants.`,
    });

    console.warn("Stale lock scanner: reverts performed", {
      revertedCount,
      revertedSlugs,
    });
  }

  return {
    scannedAt: new Date().toISOString(),
    staleFound: (staleCampaigns ?? []).length,
    reverted: revertedCount,
    revertedSlugs,
  };
}
