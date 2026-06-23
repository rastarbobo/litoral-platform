/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, it, expect, beforeEach } from "vitest";
import { getDB } from "@/db";
import {
  campaignsTable,
  restaurantsTable,
  campaignRevisionsTable,
  analyticsEventsTable,
} from "@/db/schema";
import { campaignRepo } from "@/db/repositories/campaign-repository";
import { eq, and } from "drizzle-orm";

/**
 * Integration tests for the Extension Queue lifecycle (Epic 6):
 *
 * Coverage:
 * - listApproved: returns campaigns in 'approved' status with platforms
 * - claimForScheduling: atomic claim, idempotency, multi-tenancy guard
 * - markAsScheduled: pending_schedule→scheduled, date validation
 * - listAllApprovedOlderThan: stale campaign detection for offline monitoring
 * - Full queue loop: approve → list → claim → schedule (single restaurant)
 * - Concurrent claim protection: two claims on same campaign, only one wins
 * - Hibernate restaurant: listApproved should be handled at API layer
 */

const TEST_EXTENSION_RESTAURANT = {
  id: "rest_ext_queue",
  name: "Extension Queue Test",
  slug: "extension-queue-test",
  cuisineType: "italian",
  locationArea: "soho",
  subscriptionStatus: "active_saas" as const,
  extensionAuthToken: "ext_token_abc123",
  telegramChatId: "987654321",
  googleRating: 4.3,
  reviewCount: 40,
  qualificationStatus: "qualified" as const,
  behavioralState: 0,
};

const TEST_HIBERNATE_RESTAURANT = {
  id: "rest_ext_hibernate",
  name: "Hibernate Extension Test",
  slug: "hibernate-ext-test",
  cuisineType: "french",
  locationArea: "le-marais",
  subscriptionStatus: "hibernate" as const,
  extensionAuthToken: "ext_token_hibernate",
  telegramChatId: "111222333",
  googleRating: 4.0,
  reviewCount: 20,
  qualificationStatus: "qualified" as const,
  behavioralState: 0,
};

function makeApprovedCampaign(
  restaurantId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    restaurantId,
    source: "autonomous" as const,
    campaignType: "flash_offer",
    headline: overrides.headline as string ?? "Queue Campaign",
    caption: "Test caption for extension queue",
    platforms: "instagram,facebook,tiktok,gbp",
    assetR2Key: "campaigns/test-asset.jpg",
    status: "approved" as const,
    ...overrides,
  };
}

describe("Extension Queue Lifecycle Integration", () => {
  beforeEach(async () => {
    const db = getDB();
    // Clean up
    await db.delete(campaignRevisionsTable);
    await db.delete(analyticsEventsTable);
    await db.delete(campaignsTable);
    await db.delete(restaurantsTable).where(
      and(
        eq(restaurantsTable.id, TEST_EXTENSION_RESTAURANT.id),
      ),
    );
    await db.delete(restaurantsTable).where(
      eq(restaurantsTable.id, TEST_HIBERNATE_RESTAURANT.id),
    );

    // Seed restaurants
    await db.insert(restaurantsTable).values(TEST_EXTENSION_RESTAURANT);
    await db.insert(restaurantsTable).values(TEST_HIBERNATE_RESTAURANT);
  });

  // ─── listApproved ──────────────────────────────────────────

  describe("listApproved", () => {
    it("returns approved campaigns with platforms set", async () => {
      const db = getDB();
      const campaignId = `camp_ext_${Date.now()}`;
      await db.insert(campaignsTable).values({
        id: campaignId,
        ...makeApprovedCampaign(TEST_EXTENSION_RESTAURANT.id),
      } as any);

      const result = await campaignRepo.listApproved(TEST_EXTENSION_RESTAURANT.id);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(campaignId);
      expect(result[0].status).toBe("approved");
    });

    it("returns empty array when no approved campaigns", async () => {
      // No campaigns seeded
      const result = await campaignRepo.listApproved(TEST_EXTENSION_RESTAURANT.id);
      expect(result).toHaveLength(0);
    });

    it("does NOT return campaigns without platforms", async () => {
      const db = getDB();
      await db.insert(campaignsTable).values({
        id: "camp_no_platforms",
        ...makeApprovedCampaign(TEST_EXTENSION_RESTAURANT.id, {
          platforms: null,
        }),
      } as any);

      const result = await campaignRepo.listApproved(TEST_EXTENSION_RESTAURANT.id);
      expect(result).toHaveLength(0);
    });

    it("does NOT return non-approved campaigns", async () => {
      const db = getDB();
      await db.insert(campaignsTable).values({
        id: "camp_pending",
        ...makeApprovedCampaign(TEST_EXTENSION_RESTAURANT.id, {
          status: "pending_approval",
        }),
      } as any);

      await db.insert(campaignsTable).values({
        id: "camp_rejected",
        ...makeApprovedCampaign(TEST_EXTENSION_RESTAURANT.id, {
          status: "rejected",
        }),
      } as any);

      await db.insert(campaignsTable).values({
        id: "camp_scheduled",
        ...makeApprovedCampaign(TEST_EXTENSION_RESTAURANT.id, {
          status: "scheduled",
        }),
      } as any);

      const result = await campaignRepo.listApproved(TEST_EXTENSION_RESTAURANT.id);
      expect(result).toHaveLength(0);
    });

    it("scopes results to specific restaurant", async () => {
      const db = getDB();
      await db.insert(campaignsTable).values({
        id: "camp_my_rest",
        ...makeApprovedCampaign(TEST_EXTENSION_RESTAURANT.id),
      } as any);

      // For hibernate restaurant, listApproved should also be empty
      // (the hibernate guard is at the API layer, not the repo)
      const resultForHibernate = await campaignRepo.listApproved(TEST_HIBERNATE_RESTAURANT.id);
      expect(resultForHibernate).toHaveLength(0);
    });

    it("respects max 10 campaigns per poll cycle", async () => {
      const db = getDB();
      for (let i = 0; i < 15; i++) {
        await db.insert(campaignsTable).values({
          id: `camp_bulk_${i}`,
          ...makeApprovedCampaign(TEST_EXTENSION_RESTAURANT.id, {
            headline: `Campaign ${i}`,
          }),
        } as any);
      }

      const result = await campaignRepo.listApproved(TEST_EXTENSION_RESTAURANT.id);
      expect(result.length).toBeLessThanOrEqual(10);
    });
  });

  // ─── claimForScheduling ────────────────────────────────────

  describe("claimForScheduling", () => {
    let campaignId: string;

    beforeEach(async () => {
      const db = getDB();
      campaignId = "camp_to_claim";
      await db.insert(campaignsTable).values({
        id: campaignId,
        ...makeApprovedCampaign(TEST_EXTENSION_RESTAURANT.id),
      } as any);
    });

    it("atomically claims a campaign", async () => {
      const result = await campaignRepo.claimForScheduling(
        campaignId,
        TEST_EXTENSION_RESTAURANT.id,
        TEST_EXTENSION_RESTAURANT.slug,
      );

      expect((result as { claimed: boolean }).claimed).toBe(true);

      // Verify D1 state
      const db = getDB();
      const updated = await db.query.campaignsTable.findFirst({
        where: eq(campaignsTable.id, campaignId),
      });
      expect(updated!.status).toBe("pending_schedule");
      expect(updated!.claimedAt).not.toBeNull();
      expect(updated!.claimedBy).toBe(TEST_EXTENSION_RESTAURANT.slug);
    });

    it("returns claimed=false for double claim (idempotency)", async () => {
      await campaignRepo.claimForScheduling(
        campaignId,
        TEST_EXTENSION_RESTAURANT.id,
      );

      const result = await campaignRepo.claimForScheduling(
        campaignId,
        TEST_EXTENSION_RESTAURANT.id,
      );

      expect((result as { claimed: boolean }).claimed).toBe(false);
    });

    it("returns claimed=false for wrong restaurant (multi-tenancy)", async () => {
      const result = await campaignRepo.claimForScheduling(
        campaignId,
        "rest_evil_hacker",
      );

      expect((result as { claimed: boolean }).claimed).toBe(false);

      // Campaign should still be unclaimed
      const db = getDB();
      const stillApproved = await db.query.campaignsTable.findFirst({
        where: eq(campaignsTable.id, campaignId),
      });
      expect(stillApproved!.status).toBe("approved");
    });

    it("cannot claim a campaign not in 'approved' status", async () => {
      // Manually set to scheduled
      const db = getDB();
      await db.update(campaignsTable)
        .set({ status: "scheduled" })
        .where(eq(campaignsTable.id, campaignId));

      const result = await campaignRepo.claimForScheduling(
        campaignId,
        TEST_EXTENSION_RESTAURANT.id,
      );

      expect((result as { claimed: boolean }).claimed).toBe(false);
    });

    it("accepts null slug (extension with no slug set)", async () => {
      const result = await campaignRepo.claimForScheduling(
        campaignId,
        TEST_EXTENSION_RESTAURANT.id,
        // No slug passed — should still succeed
      );

      expect((result as { claimed: boolean }).claimed).toBe(true);

      const db = getDB();
      const updated = await db.query.campaignsTable.findFirst({
        where: eq(campaignsTable.id, campaignId),
      });
      expect(updated!.claimedBy).toBeNull();
    });
  });

  // ─── markAsScheduled ───────────────────────────────────────

  describe("markAsScheduled", () => {
    let campaignId: string;

    beforeEach(async () => {
      const db = getDB();
      campaignId = "camp_to_schedule";
      await db.insert(campaignsTable).values({
        id: campaignId,
        ...makeApprovedCampaign(TEST_EXTENSION_RESTAURANT.id),
      } as any);

      // Claim first
      await campaignRepo.claimForScheduling(
        campaignId,
        TEST_EXTENSION_RESTAURANT.id,
      );
    });

    it("transitions pending_schedule → scheduled", async () => {
      const scheduledDate = new Date("2026-08-15T14:00:00Z");
      const result = await campaignRepo.markAsScheduled(
        campaignId,
        TEST_EXTENSION_RESTAURANT.id,
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
      expect(updated!.scheduledAt).toEqual(scheduledDate);
    });

    it("returns scheduled=false for non-claimed campaign", async () => {
      const db = getDB();
      const c2Id = "camp_not_claimed";
      await db.insert(campaignsTable).values({
        id: c2Id,
        ...makeApprovedCampaign(TEST_EXTENSION_RESTAURANT.id),
      } as any);

      const result = await campaignRepo.markAsScheduled(
        c2Id,
        TEST_EXTENSION_RESTAURANT.id,
        new Date(),
      );

      if ("scheduled" in result) {
        expect(result.scheduled).toBe(false);
      }
    });

    it("returns scheduled=false for wrong restaurant", async () => {
      const result = await campaignRepo.markAsScheduled(
        campaignId,
        "rest_wrong_owner",
        new Date(),
      );

      if ("scheduled" in result) {
        expect(result.scheduled).toBe(false);
      }
    });

    it("rejects non-Date scheduledAt", async () => {
      const result = await campaignRepo.markAsScheduled(
        campaignId,
        TEST_EXTENSION_RESTAURANT.id,
        "not-a-date" as any,
      );

      expect(result).toHaveProperty("type", "DATABASE_ERROR");
    });
  });

  // ─── Stale Campaign Detection ──────────────────────────────

  describe("listAllApprovedOlderThan", () => {
    it("groups stale campaigns by restaurant", async () => {
      const db = getDB();
      const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000);

      // Insert two stale campaigns for our test restaurant
      await db.insert(campaignsTable).values({
        id: "camp_stale_1",
        ...makeApprovedCampaign(TEST_EXTENSION_RESTAURANT.id, {
          createdAt: twoHoursAgo,
          updatedAt: twoHoursAgo,
        }),
      } as any);

      await db.insert(campaignsTable).values({
        id: "camp_stale_2",
        ...makeApprovedCampaign(TEST_EXTENSION_RESTAURANT.id, {
          headline: "Stale Campaign 2",
          createdAt: new Date(twoHoursAgo.getTime() + 5000),
          updatedAt: new Date(twoHoursAgo.getTime() + 5000),
        }),
      } as any);

      const result = await campaignRepo.listAllApprovedOlderThan(90); // 90 minutes threshold

      // Should group both stale campaigns under one restaurant entry
      const ourGroup = result.find(
        (g) => g.restaurantId === TEST_EXTENSION_RESTAURANT.id,
      );
      expect(ourGroup).toBeDefined();
      expect(ourGroup!.campaigns.length).toBeGreaterThanOrEqual(2);
      expect(ourGroup!.restaurantName).toBe(TEST_EXTENSION_RESTAURANT.name);
      expect(ourGroup!.telegramChatId).toBe(TEST_EXTENSION_RESTAURANT.telegramChatId);
    });

    it("excludes recently approved campaigns (within threshold)", async () => {
      const db = getDB();

      // Insert a campaign approved 5 minutes ago
      await db.insert(campaignsTable).values({
        id: "camp_fresh",
        ...makeApprovedCampaign(TEST_EXTENSION_RESTAURANT.id, {
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      } as any);

      const result = await campaignRepo.listAllApprovedOlderThan(90);

      const ourGroup = result.find(
        (g) => g.restaurantId === TEST_EXTENSION_RESTAURANT.id,
      );
      // The fresh campaign should not appear
      if (ourGroup) {
        expect(ourGroup.campaigns.every((c) => c.id !== "camp_fresh")).toBe(true);
      }
    });
  });

  // ─── Concurrent Claim Protection ───────────────────────────

  describe("concurrent claim protection", () => {
    it("only one of two concurrent claims on the same campaign succeeds", async () => {
      const db = getDB();
      const campaignId = "camp_race";
      await db.insert(campaignsTable).values({
        id: campaignId,
        ...makeApprovedCampaign(TEST_EXTENSION_RESTAURANT.id),
      } as any);

      // Simulate concurrent claims
      const [r1, r2] = await Promise.all([
        campaignRepo.claimForScheduling(
          campaignId,
          TEST_EXTENSION_RESTAURANT.id,
        ),
        campaignRepo.claimForScheduling(
          campaignId,
          TEST_EXTENSION_RESTAURANT.id,
        ),
      ]);

      const successes = [r1, r2].filter(
        (r) => "claimed" in r && r.claimed === true,
      );
      expect(successes.length).toBe(1);

      // Verify final state
      const updated = await db.query.campaignsTable.findFirst({
        where: eq(campaignsTable.id, campaignId),
      });
      expect(updated!.status).toBe("pending_schedule");
    });
  });

  // ─── Full Extension Queue Loop ─────────────────────────────

  describe("full extension loop", () => {
    it("complete cycle: approve → list → claim → schedule", async () => {
      const db = getDB();
      const campaignId = "camp_full_loop";

      // 1. Create + approve campaign
      await db.insert(campaignsTable).values({
        id: campaignId,
        ...makeApprovedCampaign(TEST_EXTENSION_RESTAURANT.id),
      } as any);

      // 2. Extension polls: listApproved
      const queue = await campaignRepo.listApproved(TEST_EXTENSION_RESTAURANT.id);
      expect(queue).toHaveLength(1);
      expect(queue[0].id).toBe(campaignId);

      // 3. Extension claims: claimForScheduling
      const claim = await campaignRepo.claimForScheduling(
        campaignId,
        TEST_EXTENSION_RESTAURANT.id,
        TEST_EXTENSION_RESTAURANT.slug,
      );
      expect((claim as { claimed: boolean }).claimed).toBe(true);

      // 4. After scheduling in native UI: markAsScheduled
      const scheduleResult = await campaignRepo.markAsScheduled(
        campaignId,
        TEST_EXTENSION_RESTAURANT.id,
        new Date("2026-09-01T09:00:00Z"),
      );
      if ("scheduled" in scheduleResult) {
        expect(scheduleResult.scheduled).toBe(true);
      }

      // 5. Polling again should return empty (campaign is now pending_schedule)
      const queueAfter = await campaignRepo.listApproved(TEST_EXTENSION_RESTAURANT.id);
      expect(queueAfter).toHaveLength(0);

      // 6. Mark as published (post-publishing step)
      await campaignRepo.updateStatus(campaignId, "published");
      const published = await db.query.campaignsTable.findFirst({
        where: eq(campaignsTable.id, campaignId),
      });
      expect(published!.status).toBe("published");
    });

    it("handles multiple campaigns in a single queue", async () => {
      const db = getDB();

      // Seed 3 approved campaigns
      for (let i = 0; i < 3; i++) {
        await db.insert(campaignsTable).values({
          id: `camp_multi_${i}`,
          ...makeApprovedCampaign(TEST_EXTENSION_RESTAURANT.id, {
            headline: `Multi Campaign ${i}`,
          }),
        } as any);
      }

      // Extension polls and gets all 3
      const queue = await campaignRepo.listApproved(TEST_EXTENSION_RESTAURANT.id);
      expect(queue).toHaveLength(3);

      // Claims each one
      for (const camp of queue) {
        const claim = await campaignRepo.claimForScheduling(
          camp.id,
          TEST_EXTENSION_RESTAURANT.id,
        );
        expect((claim as { claimed: boolean }).claimed).toBe(true);
      }

      // Subsequent polls return empty
      const queueAfter = await campaignRepo.listApproved(TEST_EXTENSION_RESTAURANT.id);
      expect(queueAfter).toHaveLength(0);
    });
  });
});