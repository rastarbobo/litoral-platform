/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, it, expect, beforeEach } from "vitest";
import { getDB } from "@/db";
import { restaurantsTable } from "@/db/schema";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { eq } from "drizzle-orm";

/**
 * Integration tests for Stripe subscription lifecycle (Epic 3, Story 3.4).
 *
 * Coverage:
 * - enrollViaStripeCheckout: prospect → active_saas transition with Stripe IDs
 * - enrollViaStripeCheckout: idempotency (ALREADY_ENROLLED)
 * - enrollViaStripeCheckout: NOT_FOUND for missing restaurants
 * - getSubscriptionStatus: active client vs prospect vs not found
 * - Subscription tier validation (starter, pro, annual_pro)
 * - Atomic conditional update guard (only transitions from 'prospect')
 */

const testRestaurant = {
  id: "rest_sub_lifecycle_test",
  name: "Sub Lifecycle Test Restaurant",
  slug: "sub-lifecycle-test",
  cuisineType: "italian",
  locationArea: "centro-storico",
  subscriptionStatus: "prospect" as const,
  googleRating: 4.5,
  reviewCount: 50,
  qualificationStatus: "qualified" as const,
  behavioralState: 0,
};

describe("Stripe Subscription Lifecycle Integration", () => {
  beforeEach(async () => {
    const db = getDB();
    // Clean up from previous runs
    await db.delete(restaurantsTable).where(eq(restaurantsTable.id, testRestaurant.id));
    // Seed fresh test restaurant
    await db.insert(restaurantsTable).values(testRestaurant);
  });

  // ─── enrollViaStripeCheckout ───────────────────────────────

  describe("enrollViaStripeCheckout", () => {
    it("transitions a prospect to active_saas with Stripe IDs", async () => {
      const result = await restaurantRepo.enrollViaStripeCheckout(
        testRestaurant.id,
        "pro",
        "cus_test_123",
        "sub_test_456",
      );

      expect(result.type).toBe("SUCCESS");
      expect((result as { restaurantId: string }).restaurantId).toBe(testRestaurant.id);

      // Verify D1 state
      const db = getDB();
      const updated = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, testRestaurant.id),
      });

      expect(updated).not.toBeNull();
      expect(updated!.subscriptionStatus).toBe("active_saas");
      expect(updated!.subscriptionTier).toBe("pro");
      expect(updated!.stripeCustomerId).toBe("cus_test_123");
      expect(updated!.stripeSubscriptionId).toBe("sub_test_456");
    });

    it("returns ALREADY_ENROLLED when restaurant is already active", async () => {
      // First enrollment
      await restaurantRepo.enrollViaStripeCheckout(
        testRestaurant.id,
        "starter",
        "cus_first",
        "sub_first",
      );

      // Second enrollment attempt (idempotency)
      const result = await restaurantRepo.enrollViaStripeCheckout(
        testRestaurant.id,
        "pro",
        "cus_second",
        "sub_second",
      );

      expect(result.type).toBe("ALREADY_ENROLLED");

      // Verify state was NOT overwritten
      const db = getDB();
      const restaurant = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, testRestaurant.id),
      });

      expect(restaurant!.subscriptionStatus).toBe("active_saas");
      expect(restaurant!.subscriptionTier).toBe("starter"); // not "pro"
      expect(restaurant!.stripeCustomerId).toBe("cus_first"); // not "cus_second"
    });

    it("returns NOT_FOUND for non-existent restaurant", async () => {
      const result = await restaurantRepo.enrollViaStripeCheckout(
        "rest_does_not_exist",
        "pro",
        "cus_nonexistent",
        "sub_nonexistent",
      );

      expect(result.type).toBe("NOT_FOUND");
    });

    it("only transitions from prospect status (conditional UPDATE)", async () => {
      // Manually set the restaurant to something other than prospect
      const db = getDB();
      await db.update(restaurantsTable)
        .set({ subscriptionStatus: "hibernate" })
        .where(eq(restaurantsTable.id, testRestaurant.id));

      const result = await restaurantRepo.enrollViaStripeCheckout(
        testRestaurant.id,
        "pro",
        "cus_test_123",
        "sub_test_456",
      );

      // Should fail — the conditional WHERE clause prevents this
      expect(result.type).not.toBe("SUCCESS");
    });
  });

  // ─── getSubscriptionStatus ──────────────────────────────────

  describe("getSubscriptionStatus", () => {
    it("returns full subscription details for an active client", async () => {
      await restaurantRepo.enrollViaStripeCheckout(
        testRestaurant.id,
        "annual_pro",
        "cus_annual_123",
        "sub_annual_456",
      );

      const status = await restaurantRepo.getSubscriptionStatus(testRestaurant.id);

      expect(status).not.toBeNull();
      expect(status!.tier).toBe("annual_pro");
      expect(status!.status).toBe("active_saas");
      expect(status!.stripeSubscriptionId).toBe("sub_annual_456");
    });

    it("returns prospect status for a non-enrolled restaurant", async () => {
      const status = await restaurantRepo.getSubscriptionStatus(testRestaurant.id);

      expect(status).not.toBeNull();
      expect(status!.status).toBe("prospect");
      expect(status!.tier).toBeNull();
      expect(status!.stripeSubscriptionId).toBeNull();
    });

    it("returns null for non-existent restaurant", async () => {
      const status = await restaurantRepo.getSubscriptionStatus("rest_nonexistent");
      expect(status).toBeNull();
    });
  });

  // ─── Tier Validation ────────────────────────────────────────

  describe("subscription tier validation", () => {
    it("accepts all valid tier values", async () => {
      const tiers = ["starter", "pro", "annual_pro"];

      for (const tier of tiers) {
        const id = `rest_tier_${tier}`;
        // Clean up first
        const db = getDB();
        await db.delete(restaurantsTable).where(eq(restaurantsTable.id, id));

        await db.insert(restaurantsTable).values({
          ...testRestaurant,
          id,
          slug: `tier-${tier}`,
        });

        const result = await restaurantRepo.enrollViaStripeCheckout(
          id,
          tier,
          `cus_${tier}`,
          `sub_${tier}`,
        );

        expect(result.type).toBe("SUCCESS");

        const updated = await db.query.restaurantsTable.findFirst({
          where: eq(restaurantsTable.id, id),
        });
        expect(updated!.subscriptionTier).toBe(tier);
      }
    });

    it("stores tier as provided without coercion", async () => {
      await restaurantRepo.enrollViaStripeCheckout(
        testRestaurant.id,
        "starter",
        "cus_starter",
        "sub_starter",
      );

      const db = getDB();
      const restaurant = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, testRestaurant.id),
      });

      // Tier should be exactly what was passed
      expect(restaurant!.subscriptionTier).toBe("starter");
    });
  });

  // ─── Bulk Enrollment — Atomicity ────────────────────────────

  describe("concurrent enrollment protection", () => {
    it("only one of two concurrent enrollments should succeed", async () => {
      // Simulate two concurrent Stripe webhooks by racing two enroll calls
      const [r1, r2] = await Promise.all([
        restaurantRepo.enrollViaStripeCheckout(
          testRestaurant.id,
          "pro",
          "cus_race_a",
          "sub_race_a",
        ),
        restaurantRepo.enrollViaStripeCheckout(
          testRestaurant.id,
          "starter",
          "cus_race_b",
          "sub_race_b",
        ),
      ]);

      // At least one must succeed — the race should not produce two successes
      const successes = [r1, r2].filter((r) => r.type === "SUCCESS");
      expect(successes.length).toBe(1); // exactly one wins

      const db = getDB();
      const restaurant = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, testRestaurant.id),
      });

      expect(restaurant!.subscriptionStatus).toBe("active_saas");
    });
  });
});