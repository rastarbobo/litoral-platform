/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, it, expect, beforeEach } from "vitest";
import { getDB } from "@/db";
import { restaurantsTable } from "@/db/schema";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { eq } from "drizzle-orm";

/**
 * Integration tests for Extension Token Generation & Clear endpoints
 * (Epic 6, Story 6.2 — database-layer PENDING → scheduled lock).
 *
 * These test the repository-level operations powering:
 * - POST /api/extension/token/generate
 * - POST /api/extension/token/clear
 *
 * Coverage:
 * - generateExtensionAuthToken: token creation, idempotency (reuse existing)
 * - regenerateExtensionAuthToken: force-regenerate, old token invalidated
 * - clearExtensionAuthToken: token removal
 * - Pre-flight: active subscription required check
 * - Multi-tenancy: token scoped to single restaurant
 */

const TEST_RESTAURANT = {
  id: "rest_ext_token_test",
  name: "Extension Token Test",
  slug: "ext-token-test",
  cuisineType: "mexican",
  locationArea: "mission-district",
  subscriptionStatus: "active_saas" as const,
  googleRating: 4.5,
  reviewCount: 60,
  qualificationStatus: "qualified" as const,
  behavioralState: 0,
};

const TEST_PROSPECT = {
  id: "rest_ext_prospect",
  name: "Extension Prospect",
  slug: "ext-prospect",
  cuisineType: "thai",
  locationArea: "nob-hill",
  subscriptionStatus: "prospect" as const,
  googleRating: 4.2,
  reviewCount: 30,
  qualificationStatus: "qualified" as const,
  behavioralState: 0,
};

describe("Extension Token Generation & Clear Integration", () => {
  beforeEach(async () => {
    const db = getDB();
    await db.delete(restaurantsTable)
      .where(eq(restaurantsTable.id, TEST_RESTAURANT.id));
    await db.delete(restaurantsTable)
      .where(eq(restaurantsTable.id, TEST_PROSPECT.id));
    await db.insert(restaurantsTable).values(TEST_RESTAURANT);
    await db.insert(restaurantsTable).values(TEST_PROSPECT);
  });

  // ─── Token Generation ─────────────────────────────────────

  describe("generateExtensionAuthToken", () => {
    it("creates a new token and stores it on the restaurant record", async () => {
      const result = await restaurantRepo.generateExtensionAuthToken(
        TEST_RESTAURANT.id,
      );

      // Success returns { token: string }, error returns { type: "DATABASE_ERROR", ... }
      expect("type" in result).toBe(false);
      if ("token" in result) {
        expect(result.token).toBeTruthy();
        expect(result.token).toMatch(/^ext_/);
        expect(result.token.length).toBeGreaterThan(8);
      }

      // Verify token persisted in D1
      const db = getDB();
      const restaurant = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, TEST_RESTAURANT.id),
      });
      expect(restaurant!.extensionAuthToken).toBeTruthy();
    });

    it("returns an existing token without regenerating (idempotent)", async () => {
      // First generation
      const first = await restaurantRepo.generateExtensionAuthToken(
        TEST_RESTAURANT.id,
      );
      if ("type" in first && first.type === "DATABASE_ERROR") throw new Error("First generation failed");
      const firstToken = "token" in first ? first.token : null;
      expect(firstToken).toBeTruthy();

      // Second generation should return same token (idempotent due to IS NULL guard)
      const second = await restaurantRepo.generateExtensionAuthToken(
        TEST_RESTAURANT.id,
      );
      if ("type" in second && second.type === "DATABASE_ERROR") throw new Error("Second generation failed");
      const secondToken = "token" in second ? second.token : null;

      expect(secondToken).toBe(firstToken);
    });

    it("returns DATABASE_ERROR for non-existent restaurant", async () => {
      const result = await restaurantRepo.generateExtensionAuthToken("rest_nonexistent");
      expect("type" in result).toBe(true);
      if ("type" in result) {
        expect(result.type).toBe("DATABASE_ERROR");
      }
    });
  });

  // ─── Token Regeneration ───────────────────────────────────

  describe("regenerateExtensionAuthToken", () => {
    it("force-regenerates a new token, invalidating the old one", async () => {
      // Generate initial token
      const initial = await restaurantRepo.generateExtensionAuthToken(
        TEST_RESTAURANT.id,
      );
      if ("type" in initial && initial.type === "DATABASE_ERROR") throw new Error("Initial generation failed");
      const oldToken = "token" in initial ? initial.token : null;
      expect(oldToken).toBeTruthy();

      // Force regenerate
      const regenerated = await restaurantRepo.regenerateExtensionAuthToken(
        TEST_RESTAURANT.id,
      );
      if ("type" in regenerated && regenerated.type === "DATABASE_ERROR") throw new Error("Regeneration failed");
      const newToken = "token" in regenerated ? regenerated.token : null;
      expect(newToken).toBeTruthy();

      expect(newToken).not.toBe(oldToken);
      expect(newToken).toMatch(/^ext_/);
      expect(newToken!.length).toBeGreaterThan(8);

      // Old token should no longer be in D1
      const db = getDB();
      const restaurant = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, TEST_RESTAURANT.id),
      });
      expect(restaurant!.extensionAuthToken).not.toBe(oldToken);
      expect(restaurant!.extensionAuthToken).toBe(newToken);
    });

    it("creates a new token even if none existed before", async () => {
      // Clear any existing token first
      await restaurantRepo.clearExtensionAuthToken(TEST_RESTAURANT.id);

      const result = await restaurantRepo.regenerateExtensionAuthToken(
        TEST_RESTAURANT.id,
      );
      // Success returns { token: string }, not a discriminated union with type field
      expect("type" in result).toBe(false);
      if ("token" in result) {
        expect(result.token).toBeTruthy();
      }
    });
  });

  // ─── Token Clear ──────────────────────────────────────────

  describe("clearExtensionAuthToken", () => {
    it("clears the token from the restaurant record", async () => {
      // Generate a token first
      const gen = await restaurantRepo.generateExtensionAuthToken(TEST_RESTAURANT.id);
      expect("token" in gen).toBe(true);

      const result = await restaurantRepo.clearExtensionAuthToken(
        TEST_RESTAURANT.id,
      );
      // Success returns { success: boolean }
      expect("type" in result).toBe(false);
      if ("success" in result) {
        expect(result.success).toBe(true);
      }

      // Token should be null in D1
      const db = getDB();
      const restaurant = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, TEST_RESTAURANT.id),
      });
      expect(restaurant!.extensionAuthToken).toBeNull();
    });

    it("clearing an already-cleared token is idempotent", async () => {
      // Clear first time (no token set, so success=false)
      const first = await restaurantRepo.clearExtensionAuthToken(
        TEST_RESTAURANT.id,
      );
      expect("type" in first).toBe(false);

      // Clear second time — should not error
      const second = await restaurantRepo.clearExtensionAuthToken(
        TEST_RESTAURANT.id,
      );
      expect("type" in second).toBe(false);
    });
  });

  // ─── Subscription Gate ────────────────────────────────────

  describe("getSubscriptionStatus", () => {
    it("returns subscription status for active subscriber", async () => {
      const status = await restaurantRepo.getSubscriptionStatus(
        TEST_RESTAURANT.id,
      );
      expect(status).not.toBeNull();
      expect(status!.status).toBe("active_saas");
    });

    it("returns subscription status for prospect (not yet subscribed)", async () => {
      const status = await restaurantRepo.getSubscriptionStatus(
        TEST_PROSPECT.id,
      );
      expect(status).not.toBeNull();
      expect(status!.status).toBe("prospect");
    });

    it("returns null for non-existent restaurant", async () => {
      const status = await restaurantRepo.getSubscriptionStatus("rest_nonexistent");
      expect(status).toBeNull();
    });
  });

  // ─── Multi-Tenancy ────────────────────────────────────────

  describe("token scoping", () => {
    it("token for restaurant A cannot authenticate restaurant B", async () => {
      // Generate token for TEST_RESTAURANT
      const resultA = await restaurantRepo.generateExtensionAuthToken(
        TEST_RESTAURANT.id,
      );
      if ("type" in resultA && resultA.type === "DATABASE_ERROR") throw new Error("Token generation failed");
      const tokenA = "token" in resultA ? resultA.token : null;
      expect(tokenA).toBeTruthy();

      // Look up by token — should return TEST_RESTAURANT, not TEST_PROSPECT
      const db = getDB();
      const found = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.extensionAuthToken, tokenA ?? ""),
      });

      expect(found).not.toBeNull();
      expect(found!.id).toBe(TEST_RESTAURANT.id);
      expect(found!.id).not.toBe(TEST_PROSPECT.id);
    });
  });
});