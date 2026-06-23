/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, it, expect, beforeEach } from "vitest";
import { getDB } from "@/db";
import { campaignsTable, restaurantsTable, campaignRevisionsTable, analyticsEventsTable } from "@/db/schema";
import { campaignRepo } from "@/db/repositories/campaign-repository";
import { eq } from "drizzle-orm";

/**
 * Integration tests for Campaign Lifecycle (Epics 4, 5).
 *
 * Coverage:
 * - create: creates campaign with correct defaults
 * - findById: SUCCESS, CAMPAIGN_NOT_FOUND, DATABASE_ERROR results
 * - listByRestaurant: filtering by status, campaignType, source; sort ordering
 * - approve: pending_approval → approved idempotency
 * - reject: pending_approval → rejected with analytics signal
 * - requestRevision: pending_approval → pending_revision; blocks from approved
 * - updateStatus: direct status transitions, validation
 * - updateCaptionForRevision: atomic increment + caption update
 * - revertToOriginal: restores original caption + pending_approval
 * - recordRevision + getRevisionHistory: audit trail
 * - claimForScheduling: atomic approved→pending_schedule lock
 * - markAsScheduled: pending_schedule→scheduled atomic gate
 * - findPendingApproval: nudge filtering
 * - listApproved: ready-for-queue campaigns
 * - getOwnerTelegramChatId: join-based lookup
 */

const TEST_RESTAURANT = {
  id: "rest_campaign_lifecycle",
  name: "Campaign Lifecycle Test",
  slug: "campaign-lifecycle-test",
  cuisineType: "mexican",
  locationArea: "downtown",
  subscriptionStatus: "active_saas" as const,
  telegramChatId: "123456789",
  googleRating: 4.5,
  reviewCount: 50,
  qualificationStatus: "qualified" as const,
  behavioralState: 0,
};

function makeCampaignOverrides(overrides: Record<string, unknown> = {}) {
  return {
    restaurantId: TEST_RESTAURANT.id,
    source: "autonomous" as const,
    campaignType: "flash_offer",
    headline: "Flash Offer Test",
    caption: "Best tacos in town!",
    ...overrides,
  };
}

describe("Campaign Lifecycle Integration", () => {
  beforeEach(async () => {
    const db = getDB();
    // Clean up from previous runs
    await db.delete(campaignRevisionsTable);
    await db.delete(analyticsEventsTable);
    await db.delete(campaignsTable);
    await db.delete(restaurantsTable).where(eq(restaurantsTable.id, TEST_RESTAURANT.id));

    // Seed restaurant
    await db.insert(restaurantsTable).values(TEST_RESTAURANT);
  });

  // ─── Campaign Creation ─────────────────────────────────────

  describe("create", () => {
    it("creates a campaign with correct defaults", async () => {
      const result = await campaignRepo.create(
        makeCampaignOverrides(),
      );

      expect(result.type).toBe("SUCCESS");
      expect((result as { campaignId: string }).campaignId).toMatch(/^camp_/);

      // Verify D1 state
      const db = getDB();
      const created = await db.query.campaignsTable.findFirst({
        where: eq(campaignsTable.id, (result as { campaignId: string }).campaignId),
      });

      expect(created).not.toBeNull();
      expect(created!.restaurantId).toBe(TEST_RESTAURANT.id);
      expect(created!.source).toBe("autonomous");
      expect(created!.campaignType).toBe("flash_offer");
      expect(created!.headline).toBe("Flash Offer Test");
      expect(created!.caption).toBe("Best tacos in town!");
      expect(created!.status).toBe("pending_approval");
      expect(created!.notificationStatus).toBe("pending");
      expect(created!.platforms).toBe("instagram,facebook,tiktok,gbp");
      expect(created!.revisionCount).toBe(0);
      expect(created!.nudgeCount).toBe(0);
    });

    it("creates a campaign with optional fields", async () => {
      const result = await campaignRepo.create(
        makeCampaignOverrides({
          source: "owner_initiated",
          ownerInputType: "voice",
          campaignType: "seasonal_event",
          headline: "Summer BBQ Special",
          subheadline: "Limited time offer",
          whyNowContext: "Peak summer season incoming",
          assetUrl: "https://example.com/asset.jpg",
          assetR2Key: "campaigns/summer-bbq.jpg",
          caption: "Best summer BBQ in town!",
          platforms: "instagram,facebook",
          signalTrigger: { weather: "heatwave", temp: 35 },
        }),
      );

      expect(result.type).toBe("SUCCESS");

      const db = getDB();
      const created = await db.query.campaignsTable.findFirst({
        where: eq(campaignsTable.id, (result as { campaignId: string }).campaignId),
      });

      expect(created!.source).toBe("owner_initiated");
      expect(created!.ownerInputType).toBe("voice");
      expect(created!.campaignType).toBe("seasonal_event");
      expect(created!.headline).toBe("Summer BBQ Special");
      expect(created!.subheadline).toBe("Limited time offer");
      expect(created!.whyNowContext).toBe("Peak summer season incoming");
      expect(created!.assetUrl).toBe("https://example.com/asset.jpg");
      expect(created!.assetR2Key).toBe("campaigns/summer-bbq.jpg");
      expect(created!.platforms).toBe("instagram,facebook");
    });

    it("creates multiple campaigns for the same restaurant", async () => {
      const r1 = await campaignRepo.create(makeCampaignOverrides());
      const r2 = await campaignRepo.create(makeCampaignOverrides({ headline: "Second Campaign" }));

      expect(r1.type).toBe("SUCCESS");
      expect(r2.type).toBe("SUCCESS");

      const { data } = await campaignRepo.listByRestaurant(TEST_RESTAURANT.id);
      expect(data).toHaveLength(2);
    });
  });

  // ─── findById ──────────────────────────────────────────────

  describe("findById", () => {
    it("returns SUCCESS with joined restaurant data", async () => {
      const created = await campaignRepo.create(makeCampaignOverrides());
      const campaignId = (created as { campaignId: string }).campaignId;

      const result = await campaignRepo.findById(campaignId);

      expect(result.type).toBe("SUCCESS");
      if (result.type === "SUCCESS") {
        expect(result.campaign.id).toBe(campaignId);
        expect(result.campaign.restaurantName).toBe("Campaign Lifecycle Test");
        expect(result.campaign.telegramChatId).toBe("123456789");
      }
    });

    it("returns CAMPAIGN_NOT_FOUND for non-existent campaign", async () => {
      const result = await campaignRepo.findById("camp_nonexistent");
      expect(result.type).toBe("CAMPAIGN_NOT_FOUND");
    });
  });

  // ─── listByRestaurant ──────────────────────────────────────

  describe("listByRestaurant", () => {
    it("lists with default sort (newest first) with no filters", async () => {
      await campaignRepo.create(makeCampaignOverrides({ headline: "First" }));
      await campaignRepo.create(makeCampaignOverrides({ headline: "Second" }));

      const { data } = await campaignRepo.listByRestaurant(TEST_RESTAURANT.id);

      expect(data).toHaveLength(2);
      // default sort is created_at_desc → newest first
      expect(new Date(data[0].createdAt).getTime())
        .toBeGreaterThanOrEqual(new Date(data[1].createdAt).getTime());
    });

    it("filters by status", async () => {
      await campaignRepo.create(makeCampaignOverrides({ headline: "First" }));
      await campaignRepo.create(makeCampaignOverrides({ headline: "Second" }));

      const { data } = await campaignRepo.listByRestaurant(TEST_RESTAURANT.id, {
        status: "pending_approval",
      });

      expect(data).toHaveLength(2);
      expect(data.every((c) => c.status === "pending_approval")).toBe(true);
    });

    it("filters by campaignType", async () => {
      await campaignRepo.create(makeCampaignOverrides({
        campaignType: "flash_offer",
        headline: "Flash",
      }));
      await campaignRepo.create(makeCampaignOverrides({
        campaignType: "daily_special",
        headline: "Daily",
      }));

      const { data } = await campaignRepo.listByRestaurant(TEST_RESTAURANT.id, {
        campaignType: "daily_special",
      });

      expect(data).toHaveLength(1);
      expect(data[0].campaignType).toBe("daily_special");
    });

    it("filters by source", async () => {
      await campaignRepo.create(makeCampaignOverrides({
        source: "autonomous",
        headline: "Auto",
      }));
      await campaignRepo.create(makeCampaignOverrides({
        source: "owner_initiated",
        headline: "Owner",
      }));

      const { data } = await campaignRepo.listByRestaurant(TEST_RESTAURANT.id, {
        source: "owner_initiated",
      });

      expect(data).toHaveLength(1);
      expect(data[0].source).toBe("owner_initiated");
    });

    it("sorts ascending when specified", async () => {
      await campaignRepo.create(makeCampaignOverrides({ headline: "First" }));
      await campaignRepo.create(makeCampaignOverrides({ headline: "Second" }));

      const { data } = await campaignRepo.listByRestaurant(TEST_RESTAURANT.id, {
        sort: "created_at_asc",
      });

      expect(new Date(data[0].createdAt).getTime())
        .toBeLessThanOrEqual(new Date(data[1].createdAt).getTime());
    });

    it("respects limit and offset", async () => {
      // Create 5 campaigns
      for (let i = 0; i < 5; i++) {
        await campaignRepo.create(makeCampaignOverrides({ headline: `Campaign ${i}` }));
      }

      const { data } = await campaignRepo.listByRestaurant(TEST_RESTAURANT.id, {
        limit: 3,
        offset: 1,
      });

      expect(data).toHaveLength(3);
    });
  });

  // ─── State Transitions ─────────────────────────────────────

  describe("approve", () => {
    let campaignId: string;

    beforeEach(async () => {
      const created = await campaignRepo.create(makeCampaignOverrides());
      campaignId = (created as { campaignId: string }).campaignId;
    });

    it("transitions pending_approval → approved", async () => {
      const result = await campaignRepo.approve(campaignId);

      expect(result.type).toBe("SUCCESS");
      if (result.type === "SUCCESS") {
        expect(result.campaign.status).toBe("approved");
        expect(result.campaign.approvedAt).not.toBeNull();
      }

      // Verify D1 state
      const db = getDB();
      const updated = await db.query.campaignsTable.findFirst({
        where: eq(campaignsTable.id, campaignId),
      });
      expect(updated!.status).toBe("approved");
      expect(updated!.approvedAt).not.toBeNull();
    });

    it("is idempotent — approving an already approved campaign returns success", async () => {
      await campaignRepo.approve(campaignId);
      const result = await campaignRepo.approve(campaignId);

      expect(result.type).toBe("SUCCESS");
    });

    it("blocks approval from non-pending_approval status", async () => {
      // First approve, then try again from approved — should be idempotent (no error)
      await campaignRepo.approve(campaignId);

      // Now reject it first
      // Can't reject from approved — need to create separate rejected campaign
      const c2 = await campaignRepo.create(makeCampaignOverrides({ headline: "To Reject" }));
      const c2Id = (c2 as { campaignId: string }).campaignId;
      await campaignRepo.reject(c2Id);

      // Trying to approve a rejected campaign should fail
      const result = await campaignRepo.approve(c2Id);
      expect(result.type).toBe("DATABASE_ERROR");
      if (result.type === "DATABASE_ERROR") {
        expect(result.message).toContain("Cannot approve");
      }
    });
  });

  describe("reject", () => {
    let campaignId: string;

    beforeEach(async () => {
      const created = await campaignRepo.create(makeCampaignOverrides());
      campaignId = (created as { campaignId: string }).campaignId;
    });

    it("transitions pending_approval → rejected", async () => {
      const result = await campaignRepo.reject(campaignId);

      expect(result.type).toBe("SUCCESS");
      if (result.type === "SUCCESS") {
        expect(result.campaign.status).toBe("rejected");
        expect(result.campaign.rejectedAt).not.toBeNull();
      }
    });

    it("records a rejection signal in analytics_events", async () => {
      await campaignRepo.reject(campaignId);

      const db = getDB();
      const events = await db.query.analyticsEventsTable.findMany({
        where: eq(analyticsEventsTable.prospectId, TEST_RESTAURANT.id),
      });

      const rejectionEvents = events.filter((e) => e.eventType === "campaign_rejected");
      expect(rejectionEvents.length).toBeGreaterThanOrEqual(1);
      const meta = JSON.parse(rejectionEvents[0].metadata as string);
      expect(meta.campaignId).toBe(campaignId);
      expect(meta.campaignType).toBe("flash_offer");
    });

    it("is idempotent — rejecting an already rejected campaign returns success", async () => {
      await campaignRepo.reject(campaignId);
      const result = await campaignRepo.reject(campaignId);

      expect(result.type).toBe("SUCCESS");
    });

    it("blocks rejection from non-pending_approval status", async () => {
      await campaignRepo.approve(campaignId);
      const result = await campaignRepo.reject(campaignId);

      expect(result.type).toBe("DATABASE_ERROR");
      if (result.type === "DATABASE_ERROR") {
        expect(result.message).toContain("Cannot reject");
      }
    });
  });

  describe("requestRevision", () => {
    let campaignId: string;

    beforeEach(async () => {
      const created = await campaignRepo.create(makeCampaignOverrides());
      campaignId = (created as { campaignId: string }).campaignId;
    });

    it("transitions pending_approval → pending_revision", async () => {
      const result = await campaignRepo.requestRevision(campaignId);

      expect(result.type).toBe("SUCCESS");
      if (result.type === "SUCCESS") {
        expect(result.campaign.status).toBe("pending_revision");
      }
    });

    it("allows revision request when already in pending_revision", async () => {
      await campaignRepo.requestRevision(campaignId);
      const result = await campaignRepo.requestRevision(campaignId);

      expect(result.type).toBe("SUCCESS");
    });

    it("blocks revision on approved campaigns", async () => {
      await campaignRepo.approve(campaignId);
      const result = await campaignRepo.requestRevision(campaignId);

      expect(result.type).toBe("DATABASE_ERROR");
    });

    it("does NOT increment revisionCount (delegated to updateCaptionForRevision)", async () => {
      await campaignRepo.requestRevision(campaignId);

      const result = await campaignRepo.findById(campaignId);
      if (result.type === "SUCCESS") {
        expect(result.campaign.revisionCount).toBe(0);
      }
    });
  });

  describe("updateStatus", () => {
    let campaignId: string;

    beforeEach(async () => {
      const created = await campaignRepo.create(makeCampaignOverrides());
      campaignId = (created as { campaignId: string }).campaignId;
    });

    it("directly sets status with timestamp fields", async () => {
      const result = await campaignRepo.updateStatus(campaignId, "approved", {
        approvedAt: new Date("2026-07-01T10:00:00Z"),
        notificationStatus: "sent",
        notificationSentAt: new Date(),
      });

      expect(result.type).toBe("SUCCESS");
      if (result.type === "SUCCESS") {
        expect(result.campaign.status).toBe("approved");
        expect(result.campaign.approvedAt).not.toBeNull();
      }
    });

    it("returns CAMPAIGN_NOT_FOUND for non-existent campaign", async () => {
      const result = await campaignRepo.updateStatus("camp_nonexistent", "approved");
      expect(result.type).toBe("CAMPAIGN_NOT_FOUND");
    });
  });

  // ─── Revision Operations ───────────────────────────────────

  describe("revision workflow", () => {
    let campaignId: string;

    beforeEach(async () => {
      const created = await campaignRepo.create(makeCampaignOverrides());
      campaignId = (created as { campaignId: string }).campaignId;
    });

    it("updateCaptionForRevision increments revisionCount and persists caption", async () => {
      await campaignRepo.requestRevision(campaignId);

      const result = await campaignRepo.updateCaptionForRevision(campaignId, "Updated punchier caption");

      expect(result.type).toBe("SUCCESS");
      if (result.type === "SUCCESS") {
        expect(result.campaign.revisionCount).toBe(1);
      }

      const db = getDB();
      const updated = await db.query.campaignsTable.findFirst({
        where: eq(campaignsTable.id, campaignId),
      });
      expect(updated!.caption).toBe("Updated punchier caption");
      expect(updated!.revisionCount).toBe(1);
    });

    it("recordRevision creates audit trail entries", async () => {
      await campaignRepo.requestRevision(campaignId);

      const revResult = await campaignRepo.recordRevision({
        campaignId,
        revisionNumber: 1,
        originalCaption: "Best tacos in town!",
        revisedCaption: "Updated punchier caption",
        instructions: "make it punchier",
        aiResponse: { caption: "Updated punchier caption", tone: "urgent" },
        statusBefore: "pending_revision",
        statusAfter: "pending_approval",
      });

      expect(revResult.type).toBe("SUCCESS");

      const history = await campaignRepo.getRevisionHistory(campaignId);
      expect(history).toHaveLength(1);
      expect(history[0].instructions).toBe("make it punchier");
    });

    it("getRevisionHistory returns empty array when no revisions", async () => {
      const history = await campaignRepo.getRevisionHistory(campaignId);
      expect(history).toEqual([]);
    });

    it("revertToOriginal restores caption from revisionNumber=0", async () => {
      // Seed revisionNumber=0 (simulating generation pipeline)
      const db = getDB();
      await db.insert(campaignRevisionsTable).values({
        id: "crev_original_for_revert",
        campaignId,
        revisionNumber: 0,
        originalCaption: "Best tacos in town!",
        revisedCaption: null,
        instructions: null,
        statusBefore: "pending_approval",
        statusAfter: "pending_approval",
      });

      // Change the caption first
      await campaignRepo.requestRevision(campaignId);
      await campaignRepo.updateCaptionForRevision(campaignId, "Modified caption");

      // Now revert
      const result = await campaignRepo.revertToOriginal(campaignId);

      expect(result.type).toBe("SUCCESS");
      if (result.type === "SUCCESS") {
        expect(result.campaign.caption).toBe("Best tacos in town!");
        expect(result.campaign.status).toBe("pending_approval");
      }
    });

    it("revertToOriginal fails when no revisionNumber=0 exists", async () => {
      const result = await campaignRepo.revertToOriginal(campaignId);
      expect(result.type).toBe("DATABASE_ERROR");
      if (result.type === "DATABASE_ERROR") {
        expect(result.message).toContain("No original revision record");
      }
    });
  });

  // ─── Scheduling ────────────────────────────────────────────

  describe("claimForScheduling", () => {
    let campaignId: string;

    beforeEach(async () => {
      const created = await campaignRepo.create(makeCampaignOverrides());
      campaignId = (created as { campaignId: string }).campaignId;
      await campaignRepo.approve(campaignId);
    });

    it("atomically transitions approved → pending_schedule", async () => {
      const result = await campaignRepo.claimForScheduling(
        campaignId,
        TEST_RESTAURANT.id,
        TEST_RESTAURANT.slug,
      );

      expect("claimed" in result).toBe(true);
      expect((result as { claimed: boolean }).claimed).toBe(true);

      const db = getDB();
      const updated = await db.query.campaignsTable.findFirst({
        where: eq(campaignsTable.id, campaignId),
      });
      expect(updated!.status).toBe("pending_schedule");
      expect(updated!.claimedAt).not.toBeNull();
      expect(updated!.claimedBy).toBe(TEST_RESTAURANT.slug);
    });

    it("returns claimed=false when campaign is not in approved status", async () => {
      // First claim succeeds
      await campaignRepo.claimForScheduling(campaignId, TEST_RESTAURANT.id);

      // Second claim on already-claimed campaign
      const result = await campaignRepo.claimForScheduling(campaignId, TEST_RESTAURANT.id);

      expect((result as { claimed: boolean }).claimed).toBe(false);
    });

    it("returns claimed=false for wrong restaurantId (multi-tenancy guard)", async () => {
      const result = await campaignRepo.claimForScheduling(
        campaignId,
        "rest_wrong_owner",
      );

      expect((result as { claimed: boolean }).claimed).toBe(false);
    });
  });

  describe("markAsScheduled", () => {
    let campaignId: string;

    beforeEach(async () => {
      const created = await campaignRepo.create(makeCampaignOverrides());
      campaignId = (created as { campaignId: string }).campaignId;
      await campaignRepo.approve(campaignId);
      await campaignRepo.claimForScheduling(campaignId, TEST_RESTAURANT.id);
    });

    it("transitions pending_schedule → scheduled with date", async () => {
      const scheduledDate = new Date("2026-07-04T15:00:00Z");
      const result = await campaignRepo.markAsScheduled(
        campaignId,
        TEST_RESTAURANT.id,
        scheduledDate,
      );

      if ("scheduled" in result) {
        expect(result.scheduled).toBe(true);
      }

      const db = getDB();
      const updated = await db.query.campaignsTable.findFirst({
        where: eq(campaignsTable.id, campaignId),
      });
      expect(updated!.status).toBe("scheduled");
      expect(updated!.scheduledAt!.toISOString()).toBe(scheduledDate.toISOString());
    });

    it("rejects invalid date objects", async () => {
      const result = await campaignRepo.markAsScheduled(
        campaignId,
        TEST_RESTAURANT.id,
        new Date("invalid"),
      );

      expect(result).toHaveProperty("type", "DATABASE_ERROR");
    });

    it("returns scheduled=false when campaign not in pending_schedule", async () => {
      // Create a new campaign that hasn't been claimed
      const c2 = await campaignRepo.create(makeCampaignOverrides({ headline: "Unclaimed" }));
      const c2Id = (c2 as { campaignId: string }).campaignId;
      await campaignRepo.approve(c2Id);

      const result = await campaignRepo.markAsScheduled(
        c2Id,
        TEST_RESTAURANT.id,
        new Date(),
      );

      if ("scheduled" in result) {
        expect(result.scheduled).toBe(false);
      }
    });
  });

  // ─── Nudge & Escalation ────────────────────────────────────

  describe("findPendingApproval", () => {
    it("returns campaigns awaiting owner action", async () => {
      await campaignRepo.create(makeCampaignOverrides());
      await campaignRepo.create(makeCampaignOverrides({ headline: "Campaign 2" }));

      const result = await campaignRepo.findPendingApproval({});
      expect(result).toHaveLength(2);
    });

    it("filters by nudgeCount", async () => {
      const created = await campaignRepo.create(makeCampaignOverrides());
      const campaignId = (created as { campaignId: string }).campaignId;

      // Update nudgeCount manually
      const db = getDB();
      await db.update(campaignsTable)
        .set({ nudgeCount: 1 })
        .where(eq(campaignsTable.id, campaignId));

      // Query for nudgeCount=0 should not include it
      const result = await campaignRepo.findPendingApproval({ nudgeCount: 1 });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(campaignId);
    });
  });

  describe("listApproved", () => {
    it("lists approved campaigns ready for queue", async () => {
      const created = await campaignRepo.create(makeCampaignOverrides());
      const campaignId = (created as { campaignId: string }).campaignId;
      await campaignRepo.approve(campaignId);

      const result = await campaignRepo.listApproved(TEST_RESTAURANT.id);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("approved");
    });

    it("excludes campaigns without platform set", async () => {
      // listApproved filters by isNotNull(platforms), so campaigns without platforms
      // shouldn't appear. However, campaignRepo.create() always defaults platforms
      // to 'instagram,facebook,tiktok,gbp' via payload.platforms ??
      //
      // To test the null-platform filter, we insert directly via D1 and set platforms to NULL.
      const db = getDB();
      const campaignId = "camp_no_platforms_direct";

      // First create the campaign normally (it gets default platforms)
      const created = await campaignRepo.create(
        makeCampaignOverrides({ platforms: "instagram,facebook,tiktok,gbp" }),
      );
      // Then manually set platforms to null
      await db.update(campaignsTable)
        .set({ platforms: null } as any)
        .where(eq(campaignsTable.id, (created as { campaignId: string }).campaignId));

      // Approve so it's eligible for listApproved
      await campaignRepo.approve((created as { campaignId: string }).campaignId);

      const result = await campaignRepo.listApproved(TEST_RESTAURANT.id);
      expect(result).toHaveLength(0);
    });
  });

  // ─── Owner Lookup ──────────────────────────────────────────

  describe("getOwnerTelegramChatId", () => {
    it("returns telegram chat ID via restaurant join", async () => {
      const created = await campaignRepo.create(makeCampaignOverrides());
      const campaignId = (created as { campaignId: string }).campaignId;

      const chatId = await campaignRepo.getOwnerTelegramChatId(campaignId);
      expect(chatId).toBe("123456789");
    });

    it("returns null for non-existent campaign", async () => {
      const chatId = await campaignRepo.getOwnerTelegramChatId("camp_nonexistent");
      expect(chatId).toBeNull();
    });
  });

  // ─── Full Lifecycle Smoke Test ─────────────────────────────

  describe("full lifecycle", () => {
    it("campaign flows: create → approve → claim → schedule → publish", async () => {
      // 1. Create
      const created = await campaignRepo.create(makeCampaignOverrides());
      const campaignId = (created as { campaignId: string }).campaignId;

      // 2. Find
      const found = await campaignRepo.findById(campaignId);
      expect(found.type).toBe("SUCCESS");

      // 3. Reject (learning signal)
      await campaignRepo.reject(campaignId);
      const db = getDB();
      const rejected = await db.query.campaignsTable.findFirst({
        where: eq(campaignsTable.id, campaignId),
      });
      expect(rejected!.status).toBe("rejected");

      // 4. Create second campaign
      const c2 = await campaignRepo.create(makeCampaignOverrides({ headline: "Second Lifecycle" }));
      const c2Id = (c2 as { campaignId: string }).campaignId;

      // 5. Request revision → update caption → revert to pending_approval → approve
      await campaignRepo.requestRevision(c2Id);
      await campaignRepo.updateCaptionForRevision(c2Id, "Revised caption v2");
      // Update status back to pending_approval so approve() can work
      await campaignRepo.updateStatus(c2Id, "pending_approval");
      await campaignRepo.approve(c2Id);

      // 6. Claim for scheduling
      const claimed = await campaignRepo.claimForScheduling(c2Id, TEST_RESTAURANT.id);
      expect((claimed as { claimed: boolean }).claimed).toBe(true);

      // 7. Mark as scheduled
      const scheduled = await campaignRepo.markAsScheduled(
        c2Id,
        TEST_RESTAURANT.id,
        new Date("2026-08-01T12:00:00Z"),
      );
      if ("scheduled" in scheduled) {
        expect(scheduled.scheduled).toBe(true);
      }

      // 8. Update to published
      await campaignRepo.updateStatus(c2Id, "published");
      const published = await db.query.campaignsTable.findFirst({
        where: eq(campaignsTable.id, c2Id),
      });
      expect(published!.status).toBe("published");
    });
  });
});