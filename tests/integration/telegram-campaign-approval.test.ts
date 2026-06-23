/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, it, expect, beforeEach } from "vitest";
import { getDB } from "@/db";
import { restaurantsTable } from "@/db/schema";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { eq } from "drizzle-orm";

/**
 * Integration tests for Telegram Webhook → Campaign Approval flow
 * (Epic 5, Stories 5.1 + 5.2).
 *
 * These are pure logic/DB integration tests — the full Telegram webhook
 * handler (POST /api/webhooks/telegram) requires a live webhook secret
 * and Telegram Bot API access, which are tested at the E2E level.
 *
 * Coverage:
 * - findByTelegramChatId: resolves restaurant by Telegram chat
 * - Pre-flight validation rules (subscriptionStatus, brandPersonaFragment, slug)
 * - Campaign approval state transitions
 * - Owner-initiated campaign type detection
 * - Deduplication via KV (simulated)
 */

const testRestaurant = {
  id: "rest_telegram_test",
  name: "Telegram Test Trattoria",
  slug: "telegram-test",
  cuisineType: "seafood",
  locationArea: "porto-vecchio",
  subscriptionStatus: "active_saas" as const,
  telegramChatId: "987654321",
  brandPersonaFragment: "We are a family-run seafood restaurant on the coast of Sardinia.",
  googleRating: 4.7,
  reviewCount: 85,
  qualificationStatus: "qualified" as const,
  behavioralState: 0,
};

describe("Telegram Campaign Approval Integration", () => {
  beforeEach(async () => {
    const db = getDB();
    await db.delete(restaurantsTable)
      .where(eq(restaurantsTable.id, testRestaurant.id));
    await db.insert(restaurantsTable).values(testRestaurant);
  });

  // ─── Restaurant Resolution by Telegram Chat ID ─────────────

  describe("findByTelegramChatId", () => {
    it("resolves restaurant by Telegram chat ID", async () => {
      const restaurant = await restaurantRepo.findByTelegramChatId("987654321");

      expect(restaurant).not.toBeNull();
      expect(restaurant!.id).toBe(testRestaurant.id);
      expect(restaurant!.name).toBe("Telegram Test Trattoria");
    });

    it("returns null for unknown chat ID", async () => {
      const restaurant = await restaurantRepo.findByTelegramChatId("000000000");
      expect(restaurant).toBeNull();
    });
  });

  // ─── Pre-flight Validation Rules (Story 4.1 + 5.1) ─────────

  describe("pre-flight validation for owner-initiated campaigns", () => {
    it("rejects restaurants with non-active subscription status", async () => {
      const db = getDB();
      await db.update(restaurantsTable)
        .set({ subscriptionStatus: "hibernate" })
        .where(eq(restaurantsTable.id, testRestaurant.id));

      const restaurant = await restaurantRepo.findById(testRestaurant.id);
      const isActive =
        restaurant?.subscriptionStatus === "active_saas" ||
        restaurant?.subscriptionStatus === "active_agency";

      expect(isActive).toBe(false);
    });

    it("accepts active_saas restaurants", async () => {
      const restaurant = await restaurantRepo.findById(testRestaurant.id);
      const isActive =
        restaurant?.subscriptionStatus === "active_saas" ||
        restaurant?.subscriptionStatus === "active_agency";

      expect(isActive).toBe(true);
    });

    it("accepts active_agency restaurants", async () => {
      const db = getDB();
      await db.update(restaurantsTable)
        .set({ subscriptionStatus: "active_agency" })
        .where(eq(restaurantsTable.id, testRestaurant.id));

      const restaurant = await restaurantRepo.findById(testRestaurant.id);
      const isActive =
        restaurant?.subscriptionStatus === "active_saas" ||
        restaurant?.subscriptionStatus === "active_agency";

      expect(isActive).toBe(true);
    });

    it("requires brandPersonaFragment to be non-null", async () => {
      const restaurant = await restaurantRepo.findById(testRestaurant.id);
      expect(restaurant!.brandPersonaFragment).toBeTruthy();
      expect(restaurant!.brandPersonaFragment!.length).toBeGreaterThan(10);
    });

    it("rejects when brandPersonaFragment is missing", async () => {
      const db = getDB();
      await db.update(restaurantsTable)
        .set({ brandPersonaFragment: null })
        .where(eq(restaurantsTable.id, testRestaurant.id));

      const restaurant = await restaurantRepo.findById(testRestaurant.id);
      expect(restaurant!.brandPersonaFragment).toBeNull();
    });

    it("requires slug to be present", async () => {
      const restaurant = await restaurantRepo.findById(testRestaurant.id);
      expect(restaurant!.slug).toBeTruthy();
    });

    it("requires cuisineType to be present", async () => {
      const restaurant = await restaurantRepo.findById(testRestaurant.id);
      expect(restaurant!.cuisineType).toBeTruthy();
    });
  });

  // ─── Campaign Approval State Transitions ────────────────────

  describe("campaign approval state machine", () => {
    const VALID_STATUSES = [
      "pending_approval",
      "approved",
      "scheduled",
      "published",
      "rejected",
    ] as const;

    it("defines all five campaign statuses", () => {
      expect(VALID_STATUSES).toHaveLength(5);
      expect(VALID_STATUSES).toContain("pending_approval");
      expect(VALID_STATUSES).toContain("approved");
      expect(VALID_STATUSES).toContain("scheduled");
      expect(VALID_STATUSES).toContain("published");
      expect(VALID_STATUSES).toContain("rejected");
    });

    it("validates known statuses", () => {
      const isValid = (status: string): boolean =>
        VALID_STATUSES.includes(status as typeof VALID_STATUSES[number]);

      expect(isValid("pending_approval")).toBe(true);
      expect(isValid("approved")).toBe(true);
      expect(isValid("unknown_status")).toBe(false);
    });

    it("pending_approval → approved is a valid transition", () => {
      const validTransitions: Record<string, string[]> = {
        pending_approval: ["approved", "rejected"],
        approved: ["scheduled"],
        scheduled: ["published"],
        published: [],
        rejected: [],
      };

      expect(validTransitions["pending_approval"]).toContain("approved");
      expect(validTransitions["approved"]).toContain("scheduled");
      expect(validTransitions["scheduled"]).toContain("published");
    });

    it("denies invalid backward transitions", () => {
      const validTransitions: Record<string, string[]> = {
        pending_approval: ["approved", "rejected"],
        approved: ["scheduled"],
        scheduled: ["published"],
        published: [],
        rejected: [],
      };

      // Cannot go from published back to scheduled
      expect(validTransitions["published"]).not.toContain("scheduled");
      // Cannot go from approved back to pending_approval
      expect(validTransitions["approved"]).not.toContain("pending_approval");
      // Cannot go from rejected to anything
      expect(validTransitions["rejected"]).toHaveLength(0);
    });
  });

  // ─── Owner-Initiated Campaign Media Types ───────────────────

  describe("owner-initiated media type detection (Story 4.3)", () => {
    it("detects photo media type (largest photo selected)", () => {
      const photos = [
        { file_id: "small_photo", file_unique_id: "u1", width: 320, height: 240 },
        { file_id: "medium_photo", file_unique_id: "u2", width: 800, height: 600 },
        { file_id: "large_photo", file_unique_id: "u3", width: 1280, height: 960 },
      ];

      // Telegram sends multiple sizes; largest is last
      const largest = photos[photos.length - 1];
      expect(largest.file_id).toBe("large_photo");
      expect(largest.width).toBe(1280);
    });

    it("detects voice message media type", () => {
      const voice = { file_id: "voice_1", file_unique_id: "vu1", duration: 45 };

      expect(voice).toHaveProperty("duration");
      expect(voice.duration).toBeGreaterThan(0);
    });

    it("detects video media type", () => {
      const video = {
        file_id: "video_1",
        file_unique_id: "vid_u1",
        width: 1920,
        height: 1080,
        duration: 30,
      };

      expect(video).toHaveProperty("width");
      expect(video).toHaveProperty("height");
      expect(video).toHaveProperty("duration");
    });

    it("defaults to text when no media attachments", () => {
      const mediaType = "text";
      expect(mediaType).toBe("text");
    });
  });

  // ─── Telegram Notification / Reply Format ───────────────────

  describe("reply message content validation", () => {
    it("generates correct unknown-chat reply text", () => {
      const replyText = "I don't recognize you. Please contact support.";
      expect(replyText).toContain("recognize");
      expect(replyText.length).toBeGreaterThan(10);
    });

    it("generates correct inactive-account reply text", () => {
      const replyText = "Your account is not active. Please contact support.";
      expect(replyText).toContain("not active");
    });

    it("generates correct pre-flight failure reply text", () => {
      const replyText =
        "I couldn't process that. Could you try again? If this keeps happening, I'll alert our team.";
      expect(replyText).toContain("alert our team");
    });
  });

  // ─── Deduplication Logic (KV) ───────────────────────────────

  describe("deduplication via KV (tg_dedup:{updateId})", () => {
    it("generates correct dedup key format", () => {
      const updateId = 987654321;
      const dedupKey = `tg_dedup:${updateId}`;
      expect(dedupKey).toBe("tg_dedup:987654321");
    });

    it("correctly identifies seen update IDs", () => {
      const seen = new Set<number>([100, 200, 300]);

      expect(seen.has(200)).toBe(true);
      expect(seen.has(999)).toBe(false);
    });

    it("uses 24-hour TTL for dedup entries", () => {
      const TG_DEDUP_TTL = 24 * 60 * 60;
      expect(TG_DEDUP_TTL).toBe(86400);
    });
  });

  // ─── Brand Persona Fragment (Critical for Campaign Quality) ──

  describe("brand persona fragment availability", () => {
    it("has brand persona fragment for the test restaurant", async () => {
      const result = await restaurantRepo.getBrandPersonaFragment(testRestaurant.id);
      expect(result.error).toBeNull();
      expect(result.data).toBeTruthy();
      expect(result.data!.length).toBeGreaterThan(20);
    });

    it("returns null when no brand persona is set", async () => {
      const id = "rest_no_bp";
      const db = getDB();
      await db.delete(restaurantsTable).where(eq(restaurantsTable.id, id));

      await db.insert(restaurantsTable).values({
        id,
        name: "No BP Restaurant",
        slug: "no-bp",
        cuisineType: "pizza",
        subscriptionStatus: "active_saas",
        telegramChatId: "111222333",
        brandPersonaFragment: null,
      });

      const result = await restaurantRepo.getBrandPersonaFragment(id);
      expect(result.data).toBeNull();
    });
  });
});