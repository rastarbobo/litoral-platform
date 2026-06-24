"use server-only";

import { eq, and, desc, asc, sql, isNotNull, lte, SQL } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { getDB } from "@/db";
import { campaignsTable, restaurantsTable, campaignRevisionsTable, analyticsEventsTable, type Campaign, type CampaignRevision } from "@/db/schema";
import { tryCatch } from "@/lib/try-catch";

// ─── Types ───────────────────────────────────────────────

interface CampaignNotFoundError {
  type: "CAMPAIGN_NOT_FOUND";
  campaignId: string;
  message?: string;
}

interface DatabaseError {
  type: "DATABASE_ERROR";
  campaignId: string;
  message: string;
}

type CampaignResult =
  | { type: "SUCCESS"; campaign: Campaign }
  | CampaignNotFoundError
  | DatabaseError;

// ─── Repository ────────────────────────────────────────────

/**
 * CampaignRepository — centralized abstraction for all campaign D1 operations.
 *
 * Architecture compliance (ARCH-1):
 * - All campaign D1 operations MUST go through this repository.
 * - Each method signature includes restaurantId for multi-tenancy validation.
 * - Campaign status is the source of truth for the entire approval → scheduling → publishing lifecycle.
 */
class CampaignRepository {
  /**
   * Find a campaign by ID with restaurant data joined.
   * Returns a discriminated result so callers can distinguish DB errors from not-found. (Patch 10)
   */
  async findById(campaignId: string): Promise<
    | { type: "SUCCESS"; campaign: Campaign & { restaurantName?: string | null; telegramChatId?: string | null } }
    | { type: "CAMPAIGN_NOT_FOUND"; campaignId: string }
    | { type: "DATABASE_ERROR"; campaignId: string; message: string }
  > {
    const db = getDB();

    const { data, error } = await tryCatch(
      db.query.campaignsTable.findFirst({
        where: eq(campaignsTable.id, campaignId),
        with: {
          restaurant: true,
        },
      }),
    );

    if (error) {
      console.error("CampaignRepository: findById failed", { error, campaignId });
      return { type: "DATABASE_ERROR", campaignId, message: error instanceof Error ? error.message : "Unknown database error" };
    }

    if (!data) {
      return { type: "CAMPAIGN_NOT_FOUND", campaignId };
    }

    // Use typed access instead of `any` cast (Patch 11)
    const restaurant = (data as Record<string, unknown>).restaurant as { name?: string | null; telegramChatId?: string | null } | null;

    return {
      type: "SUCCESS",
      campaign: {
        ...data,
        restaurantName: restaurant?.name ?? null,
        telegramChatId: restaurant?.telegramChatId ?? null,
      },
    };
  }

  /**
   * List campaigns for a restaurant, optionally filtered by status,
   * campaign type, source, and sorted by created_at.
   */
  async listByRestaurant(
    restaurantId: string,
    options?: {
      status?: string;
      campaignType?: string;
      source?: string;
      sort?: "created_at_asc" | "created_at_desc";
      limit?: number;
      offset?: number;
    },
  ): Promise<{ data: Campaign[]; error?: string }> {
    const db = getDB();

    const conditions = [eq(campaignsTable.restaurantId, restaurantId)];
    if (options?.status) {
      conditions.push(eq(campaignsTable.status, options.status));
    }
    if (options?.campaignType && options.campaignType !== "all") {
      conditions.push(eq(campaignsTable.campaignType, options.campaignType));
    }
    if (options?.source && options.source !== "all") {
      conditions.push(eq(campaignsTable.source, options.source as "autonomous" | "owner_initiated"));
    }

    const sortOrder =
      options?.sort === "created_at_asc"
        ? () => [asc(campaignsTable.createdAt)]
        : () => [desc(campaignsTable.createdAt)];
    const typedSortOrder = sortOrder as unknown as (fields: NonNullable<unknown>, operators: { asc: typeof asc; desc: typeof desc }) => SQL<unknown>[];


    const { data, error } = await tryCatch(
      db.query.campaignsTable.findMany({
        where: conditions.length > 1 ? and(...conditions) : conditions[0],
        limit: options?.limit ?? 50,
        offset: options?.offset ?? 0,
        orderBy: typedSortOrder,
      }),
    );

    if (error) {
      console.error("CampaignRepository: listByRestaurant failed", { error, restaurantId });
      return { data: [], error: error instanceof Error ? error.message : "Unknown database error" };
    }

    return { data: data ?? [] };
  }

  /**
   * Create a new campaign (called by the Architect Engine after generation).
   */
  async create(payload: {
    restaurantId: string;
    source: "autonomous" | "owner_initiated";
    ownerInputType?: "photo" | "voice" | "text" | "video";
    campaignType: string;
    headline?: string;
    subheadline?: string;
    whyNowContext?: string;
    assetUrl?: string;
    assetR2Key?: string;
    fullAssetR2Key?: string;
    caption?: string;
    platforms?: string;
    signalTrigger?: Record<string, unknown>;
  }): Promise<{ type: "SUCCESS"; campaignId: string } | DatabaseError> {
    const db = getDB();

    const campaignId = `camp_${createId()}`;

    const { error } = await tryCatch(
      db.insert(campaignsTable).values({
        id: campaignId,
        restaurantId: payload.restaurantId,
        source: payload.source,
        ownerInputType: payload.ownerInputType ?? null,
        campaignType: payload.campaignType,
        headline: payload.headline ?? null,
        subheadline: payload.subheadline ?? null,
        whyNowContext: payload.whyNowContext ?? null,
        assetUrl: payload.assetUrl ?? null,
        assetR2Key: payload.assetR2Key ?? null,
        fullAssetR2Key: payload.fullAssetR2Key ?? null,
        caption: payload.caption ?? null,
        platforms: payload.platforms ?? "instagram,facebook,tiktok,gbp",
        signalTrigger: payload.signalTrigger ? JSON.stringify(payload.signalTrigger) : null,
        status: "pending_approval",
        notificationStatus: "pending",
      }),
    );

    if (error) {
      console.error("CampaignRepository: create failed", { error, restaurantId: payload.restaurantId });
      return {
        type: "DATABASE_ERROR",
        campaignId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    return { type: "SUCCESS", campaignId };
  }

  /**
   * Update campaign status (with optional timestamp fields).
   * Returns the updated campaign for confirmation flow.
   */
  async updateStatus(
    campaignId: string,
    newStatus: string,
    updates?: {
      telegramMessageId?: number;
      notificationStatus?: string;
      notificationSentAt?: Date;
      lastNudgeAt?: Date;
      approvedAt?: Date;
      rejectedAt?: Date;
      revisionCount?: number;
      nudgeCount?: number;
    },
  ): Promise<CampaignResult> {
    const db = getDB();

    const updatePayload: Record<string, unknown> = { status: newStatus };

    if (updates?.telegramMessageId !== undefined) {
      updatePayload.telegramMessageId = updates.telegramMessageId;
    }
    if (updates?.notificationStatus) {
      updatePayload.notificationStatus = updates.notificationStatus;
    }
    if (updates?.notificationSentAt) {
      updatePayload.notificationSentAt = updates.notificationSentAt;
    }
    if (updates?.lastNudgeAt) {
      updatePayload.lastNudgeAt = updates.lastNudgeAt;
    }
    if (updates?.approvedAt) {
      updatePayload.approvedAt = updates.approvedAt;
    }
    if (updates?.rejectedAt) {
      updatePayload.rejectedAt = updates.rejectedAt;
    }
    if (updates?.revisionCount !== undefined) {
      updatePayload.revisionCount = updates.revisionCount;
    }
    if (updates?.nudgeCount !== undefined) {
      updatePayload.nudgeCount = updates.nudgeCount;
    }

    const { data, error } = await tryCatch(
      db
        .update(campaignsTable)
        .set(updatePayload)
        .where(eq(campaignsTable.id, campaignId))
        .returning()
        .execute(),
    );

    if (error) {
      console.error("CampaignRepository: updateStatus failed", { error, campaignId });
      return {
        type: "DATABASE_ERROR",
        campaignId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    if (!data || data.length === 0) {
      return { type: "CAMPAIGN_NOT_FOUND", campaignId };
    }

    return { type: "SUCCESS", campaign: data[0] };
  }

  /**
   * Approve a campaign (transitions from pending_approval → approved).
   * Idempotent: if already approved, returns SUCCESS without error.
   */
  async approve(campaignId: string): Promise<CampaignResult> {
    const campaign = await this.findById(campaignId);
    if (campaign.type === "CAMPAIGN_NOT_FOUND") {
      return campaign;
    }
    if (campaign.type === "DATABASE_ERROR") {
      return campaign;
    }

    // Already approved → no-op idempotency
    if (campaign.campaign.status === "approved" || campaign.campaign.status === "pending_schedule" || campaign.campaign.status === "scheduled" || campaign.campaign.status === "published") {
      return { type: "SUCCESS", campaign: campaign.campaign };
    }

    // Can only approve from pending_approval (not from rejected etc.)
    if (campaign.campaign.status !== "pending_approval") {
      return {
        type: "DATABASE_ERROR",
        campaignId,
        message: `Cannot approve campaign from status "${campaign.campaign.status}"`,
      };
    }

    return this.updateStatus(campaignId, "approved", {
      approvedAt: new Date(),
      nudgeCount: 0, // Clear nudge tracking on action (Patch 13 deferred)
      lastNudgeAt: undefined,
    });
  }

  /**
   * Reject a campaign (transitions from pending_approval → rejected).
   * Also records a learning signal for Analyst and Opportunity Detector agents (Patch 8).
   */
  async reject(campaignId: string): Promise<CampaignResult> {
    const campaign = await this.findById(campaignId);
    if (campaign.type === "CAMPAIGN_NOT_FOUND") {
      return campaign;
    }
    if (campaign.type === "DATABASE_ERROR") {
      return campaign;
    }

    // Already rejected → no-op
    if (campaign.campaign.status === "rejected") {
      return { type: "SUCCESS", campaign: campaign.campaign };
    }

    if (campaign.campaign.status !== "pending_approval") {
      return {
        type: "DATABASE_ERROR",
        campaignId,
        message: `Cannot reject campaign from status "${campaign.campaign.status}"`,
      };
    }

    // Record learning signal for Analyst and Opportunity Detector agents (Patch 8)
    await this._recordRejectionSignal(campaignId, campaign.campaign);

    return this.updateStatus(campaignId, "rejected", {
      rejectedAt: new Date(),
      nudgeCount: 0, // Clear nudge tracking on action (Patch 13 deferred)
      lastNudgeAt: undefined,
    });
  }

  /**
   * Mark campaign for revision (pending_approval → pending_revision).
   */
  async requestRevision(campaignId: string): Promise<CampaignResult> {
    const campaign = await this.findById(campaignId);
    if (campaign.type === "CAMPAIGN_NOT_FOUND") {
      return campaign;
    }
    if (campaign.type === "DATABASE_ERROR") {
      return campaign;
    }

    if (campaign.campaign.status !== "pending_approval" && campaign.campaign.status !== "pending_revision") {
      return {
        type: "DATABASE_ERROR",
        campaignId,
        message: `Cannot request revision from status "${campaign.campaign.status}"`,
      };
    }

    // revisionCount is NOT incremented here — it is incremented atomically
    // in updateCaptionForRevision when the actual revised caption is saved (Patch CR-5.2-2).
    return this.updateStatus(campaignId, "pending_revision", {
      nudgeCount: 0, // Clear nudge tracking on action (Patch 13 deferred)
      lastNudgeAt: undefined,
    });
  }

  /**
   * Find campaigns awaiting owner action for nudge/escalation.
   */
  async findPendingApproval(options: {
    olderThanMinutes?: number;
    nudgeCount?: number;
  }): Promise<Campaign[]> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db.query.campaignsTable.findMany({
        where: and(
          eq(campaignsTable.status, "pending_approval"),
        ),
        orderBy: (table) => [table.createdAt],
      }),
    );

    if (error) {
      console.error("CampaignRepository: findPendingApproval failed", { error });
      return [];
    }

    let result = data ?? [];

    // Filter for nudge logic in memory (Drizzle D1 limitations)
    if (options.nudgeCount !== undefined) {
      result = result.filter((c) => (c.nudgeCount ?? 0) === options.nudgeCount);
    }

    if (options.olderThanMinutes !== undefined) {
      const cutoff = new Date(Date.now() - options.olderThanMinutes * 60 * 1000);
      result = result.filter((c) => new Date(c.createdAt) < cutoff);
    }

    return result;
  }

  /**
   * Get owner Telegram chat ID for a campaign.
   */
  async getOwnerTelegramChatId(campaignId: string): Promise<string | null> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db
        .select({
          telegramChatId: restaurantsTable.telegramChatId,
        })
        .from(campaignsTable)
        .innerJoin(restaurantsTable, eq(campaignsTable.restaurantId, restaurantsTable.id))
        .where(eq(campaignsTable.id, campaignId))
        .execute(),
    );

    if (error || !data || data.length === 0) {
      console.error("CampaignRepository: getOwnerTelegramChatId failed", { error, campaignId });
      return null;
    }

    return data[0].telegramChatId ?? null;
  }

  /**
   * Record a campaign revision in the audit trail (Story 5.2).
   */
  async recordRevision(payload: {
    campaignId: string;
    revisionNumber: number;
    originalCaption?: string | null;
    revisedCaption?: string | null;
    instructions?: string | null;
    aiResponse?: Record<string, unknown> | null;
    statusBefore: string;
    statusAfter: string;
  }): Promise<{ type: "SUCCESS"; revisionId: string } | DatabaseError> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db.insert(campaignRevisionsTable).values({
        campaignId: payload.campaignId,
        revisionNumber: payload.revisionNumber,
        originalCaption: payload.originalCaption ?? null,
        revisedCaption: payload.revisedCaption ?? null,
        instructions: payload.instructions ?? null,
        aiResponse: payload.aiResponse ? JSON.stringify(payload.aiResponse) : null,
        statusBefore: payload.statusBefore,
        statusAfter: payload.statusAfter,
      }).returning().execute()
    );

    if (error) {
      console.error("CampaignRepository: recordRevision failed", { error, campaignId: payload.campaignId });
      return {
        type: "DATABASE_ERROR",
        campaignId: payload.campaignId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    return { type: "SUCCESS", revisionId: data?.[0]?.id ?? "" };
  }

  /**
   * Get the revision history for a campaign.
   */
  async getRevisionHistory(campaignId: string): Promise<CampaignRevision[]> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db.query.campaignRevisionsTable.findMany({
        where: eq(campaignRevisionsTable.campaignId, campaignId),
        orderBy: (table) => [table.revisionNumber],
      })
    );

    if (error) {
      console.error("CampaignRepository: getRevisionHistory failed", { error, campaignId });
      return [];
    }

    return data ?? [];
  }

  /**
   * Get the original-generation revision for a campaign (revisionNumber = 0).
   * This is guaranteed to exist when a campaign is created, as the generation
   * pipeline inserts a revision record with revisionNumber=0 (Patch CR-5.2-1).
   */
  async getOriginalRevision(campaignId: string): Promise<CampaignRevision | null> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db.query.campaignRevisionsTable.findFirst({
        where: and(
          eq(campaignRevisionsTable.campaignId, campaignId),
          eq(campaignRevisionsTable.revisionNumber, 0),
        ),
      })
    );

    if (error) {
      console.error("CampaignRepository: getOriginalRevision failed", { error, campaignId });
      return null;
    }

    return data ?? null;
  }

  /**
   * Atomically update campaign caption for a revision.
   * Increments revision_count and persists the new caption.
   */
  async updateCaptionForRevision(
    campaignId: string,
    newCaption: string,
  ): Promise<CampaignResult> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db
        .update(campaignsTable)
        .set({
          caption: newCaption,
          revisionCount: sql`${campaignsTable.revisionCount} + 1`,
        })
        .where(eq(campaignsTable.id, campaignId))
        .returning()
        .execute()
    );

    if (error) {
      console.error("CampaignRepository: updateCaptionForRevision failed", { error, campaignId });
      return {
        type: "DATABASE_ERROR",
        campaignId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    if (!data || data.length === 0) {
      return { type: "CAMPAIGN_NOT_FOUND", campaignId };
    }

    return { type: "SUCCESS", campaign: data[0] };
  }

  /**
   * Restore original caption (from revisionNumber=0) and revert status to pending_approval.
   * Looks up the original caption from the campaign_revisions table instead of
   * relying on caller-supplied value (Patch CR-5.2-3, CR-5.2-4).
   */
  async revertToOriginal(campaignId: string): Promise<CampaignResult> {
    const db = getDB();

    // Fetch the original-generation revision (revisionNumber = 0)
    const { data: originalRevision, error: fetchError } = await tryCatch(
      db.query.campaignRevisionsTable.findFirst({
        where: and(
          eq(campaignRevisionsTable.campaignId, campaignId),
          eq(campaignRevisionsTable.revisionNumber, 0),
        ),
      })
    );

    if (fetchError) {
      console.error("CampaignRepository: revertToOriginal — fetch failed", { error: fetchError, campaignId });
      return {
        type: "DATABASE_ERROR",
        campaignId,
        message: fetchError instanceof Error ? fetchError.message : "Unknown database error",
      };
    }

    if (!originalRevision) {
      return {
        type: "DATABASE_ERROR",
        campaignId,
        message: "No original revision record found (revisionNumber=0). Ensure generation pipeline creates it.",
      };
    }

    const originalCaption = originalRevision.originalCaption ?? originalRevision.revisedCaption;
    if (!originalCaption) {
      return {
        type: "DATABASE_ERROR",
        campaignId,
        message: "Original revision record exists but has no caption.",
      };
    }

    const { data, error } = await tryCatch(
      db
        .update(campaignsTable)
        .set({
          caption: originalCaption,
          status: "pending_approval",
        })
        .where(eq(campaignsTable.id, campaignId))
        .returning()
        .execute()
    );

    if (error) {
      console.error("CampaignRepository: revertToOriginal failed", { error, campaignId });
      return {
        type: "DATABASE_ERROR",
        campaignId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    if (!data || data.length === 0) {
      return { type: "CAMPAIGN_NOT_FOUND", campaignId };
    }

    return { type: "SUCCESS", campaign: data[0] };
  }

  // ─── Extension Publishing Lock (Story 6.2) ───────────────────

  /**
   * List campaigns in 'approved' status that have a platform set.
   * Used by GET /api/extension/queue for the Chrome Extension polling endpoint.
   *
   * Does NOT transition campaign state — claiming is a separate atomic operation.
   */
  async listApproved(restaurantId: string): Promise<Campaign[]> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db.query.campaignsTable.findMany({
        where: and(
          eq(campaignsTable.restaurantId, restaurantId),
          eq(campaignsTable.status, "approved"),
          isNotNull(campaignsTable.platforms),
        ),
        orderBy: (table) => [asc(table.createdAt)],
        limit: 10, // Max 10 campaigns per poll cycle
      }),
    );

    if (error) {
      console.error("CampaignRepository: listApproved failed", { error, restaurantId });
      return [];
    }

    return data ?? [];
  }

  /**
   * List all approved campaigns older than a threshold, grouped by restaurant.
   * Used by the extension offline monitor (Story 6.5) to detect campaigns
   * that have been sitting in 'approved' status without being claimed.
   *
   * Returns each restaurant's stale campaigns along with their telegram_chat_id
   * for alert routing.
   */
  async listAllApprovedOlderThan(minutes: number): Promise<
    Array<{ restaurantId: string; restaurantName: string; telegramChatId: string | null; campaigns: Campaign[] }>
  > {
    const db = getDB();
    const threshold = new Date(Date.now() - minutes * 60 * 1000);

    const { data, error } = await tryCatch(
      db
        .select({
          id: campaignsTable.id,
          restaurantId: campaignsTable.restaurantId,
          platform: campaignsTable.platforms,
          assetR2Key: campaignsTable.assetR2Key,
          caption: campaignsTable.caption,
          status: campaignsTable.status,
          campaignType: campaignsTable.campaignType,
          createdAt: campaignsTable.createdAt,
          restaurantName: restaurantsTable.name,
          telegramChatId: restaurantsTable.telegramChatId,
        })
        .from(campaignsTable)
        .innerJoin(restaurantsTable, eq(campaignsTable.restaurantId, restaurantsTable.id))
        .where(
          and(
            eq(campaignsTable.status, "approved"),
            isNotNull(campaignsTable.platforms),
            lte(campaignsTable.createdAt, threshold),
          ),
        )
        .orderBy(asc(campaignsTable.createdAt))
        .execute(),
    );

    if (error) {
      console.error("CampaignRepository: listAllApprovedOlderThan failed", { error, minutes });
      return [];
    }

    // Group by restaurant
    const grouped = new Map<string, { restaurantId: string; restaurantName: string; telegramChatId: string | null; campaigns: Campaign[] }>();

    for (const row of data ?? []) {
      const existing = grouped.get(row.restaurantId);
      if (existing) {
        existing.campaigns.push(row as unknown as Campaign);
      } else {
        grouped.set(row.restaurantId, {
          restaurantId: row.restaurantId,
          restaurantName: row.restaurantName ?? "Unknown",
          telegramChatId: row.telegramChatId ?? null,
          campaigns: [row as unknown as Campaign],
        });
      }
    }

    return Array.from(grouped.values());
  }

  /**
   * List campaigns for a restaurant by exact status.
   * Used by stale lock scanner and other status-specific queries.
   */
  async listByStatus(restaurantId: string, status: string): Promise<Campaign[]> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db.query.campaignsTable.findMany({
        where: and(
          eq(campaignsTable.restaurantId, restaurantId),
          eq(campaignsTable.status, status),
        ),
      }),
    );

    if (error) {
      console.error("CampaignRepository: listByStatus failed", { error, restaurantId, status });
      return [];
    }

    return data ?? [];
  }

  /**
   * Atomically claim a campaign for scheduling.
   *
   * Uses D1 UPDATE ... WHERE status = 'approved' for atomicity.
   * If the campaign is already claimed (or in any non-approved status),
   * the WHERE clause matches zero rows and claimed=false is returned.
   *
   * This is the core data-layer lock that prevents duplicate publishing:
   * a campaign can only ever transition from 'approved' → 'pending_schedule' once.
   */
  async claimForScheduling(
    campaignId: string,
    restaurantId: string,
    slug?: string,
  ): Promise<{ claimed: boolean } | DatabaseError> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db
        .update(campaignsTable)
        .set({
          status: "pending_schedule",
          claimedAt: new Date(),
          claimedBy: slug ?? null,
        })
        .where(
          and(
            eq(campaignsTable.id, campaignId),
            eq(campaignsTable.restaurantId, restaurantId),
            eq(campaignsTable.status, "approved"), // Atomic status gate
          ),
        )
        .returning({ id: campaignsTable.id })
        .execute(),
    );

    if (error) {
      console.error("CampaignRepository: claimForScheduling failed", { error, campaignId, restaurantId });
      return {
        type: "DATABASE_ERROR",
        campaignId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    const claimed = (data && data.length > 0) ? true : false;

    if (!claimed) {
      // Idempotent: campaign was already claimed or status changed
      console.log("CampaignRepository: claimForScheduling — not claimed (already claimed or status changed)", { campaignId, restaurantId });
    }

    return { claimed };
  }

  /**
   * Transition a claimed campaign from 'pending_schedule' → 'scheduled'.
   *
   * Called by the extension after native UI scheduling completes (Story 6.3).
   * Atomic: only transitions if the campaign is currently in 'pending_schedule' state.
   */
  async markAsScheduled(
    campaignId: string,
    restaurantId: string,
    scheduledAtDate: Date,
  ): Promise<{ scheduled: boolean } | DatabaseError> {
    if (!(scheduledAtDate instanceof Date) || isNaN(scheduledAtDate.getTime())) {
      return {
        type: "DATABASE_ERROR",
        campaignId,
        message: "Invalid scheduledAtDate: must be a valid Date object",
      };
    }

    const db = getDB();

    const { data, error } = await tryCatch(
      db
        .update(campaignsTable)
        .set({
          status: "scheduled",
          scheduledAt: scheduledAtDate,
        })
        .where(
          and(
            eq(campaignsTable.id, campaignId),
            eq(campaignsTable.restaurantId, restaurantId),
            eq(campaignsTable.status, "pending_schedule"), // Atomic state gate
          ),
        )
        .returning({ id: campaignsTable.id })
        .execute(),
    );

    if (error) {
      console.error("CampaignRepository: markAsScheduled failed", { error, campaignId, restaurantId });
      return {
        type: "DATABASE_ERROR",
        campaignId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    const scheduled = (data && data.length > 0) ? true : false;

    if (!scheduled) {
      console.warn("CampaignRepository: markAsScheduled — campaign not in pending_schedule state", { campaignId, restaurantId });
    }

    return { scheduled };
  }

  // ─── Private Helpers ─────────────────────────────────────

  /**
   * Record rejection as a learning signal for Analyst and Opportunity Detector agents.
   * Writes to analytics_events table with 'campaign_rejected' event type (Patch 8).
   */
  private async _recordRejectionSignal(
    campaignId: string,
    campaign: Campaign & { restaurantName?: string | null },
  ): Promise<void> {
    const db = getDB();
    try {
      await db.insert(analyticsEventsTable).values({
        eventType: "campaign_rejected",
        prospectId: campaign.restaurantId,
        metadata: JSON.stringify({
          campaignId,
          restaurantName: (campaign as unknown as Record<string, unknown>).restaurantName ?? null,
          campaignType: campaign.campaignType,
          headline: campaign.headline,
          signalTrigger: campaign.signalTrigger,
          whyNowContext: campaign.whyNowContext,
          rejectedAt: new Date().toISOString(),
        }),
      });
    } catch (err) {
      // Don't fail the main reject flow if analytics write fails
      console.error("CampaignRepository: _recordRejectionSignal failed (non-critical)", {
        error: err instanceof Error ? err.message : "Unknown",
        campaignId,
      });
    }
  }

  private _generateId(): string {
    // Kept for backward compat; new code uses createId() via cuid2 (Patch 2)
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

// ─── Singleton Export ──────────────────────────────────────

export const campaignRepo = new CampaignRepository();
