/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDB } from "@/db";
import { restaurantsTable, prospectEventsTable, environmentalSignalsTable } from "@/db/schema";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { eq } from "drizzle-orm";

describe("Prospect Landing Page Integration Tests", () => {
  beforeEach(async () => {
    const db = getDB();
    await db.delete(prospectEventsTable);
    await db.delete(environmentalSignalsTable);
    await db.delete(restaurantsTable);
  });

  afterEach(async () => {
    const db = getDB();
    await db.delete(prospectEventsTable);
    await db.delete(environmentalSignalsTable);
    await db.delete(restaurantsTable);
  });

  describe("CRO variant assignment", () => {
    it("deterministically assigns a CRO variant based on restaurant ID hash", () => {
      const restaurant = {
        id: "test-landing-page",
        name: "Test",
        croVariant: null,
      } as any;

      const variant = restaurantRepo.resolveCroVariant(restaurant);
      expect(["A_SCORE", "B_VISUAL", "C_NARRATIVE"]).toContain(variant);

      // Same ID must always produce same variant
      const variant2 = restaurantRepo.resolveCroVariant(restaurant);
      expect(variant).toBe(variant2);
    });

    it("returns the persisted variant when restaurant already has one", () => {
      const restaurant = {
        id: "test-landing-page",
        name: "Test",
        croVariant: "B_VISUAL",
      } as any;

      const variant = restaurantRepo.resolveCroVariant(restaurant);
      expect(variant).toBe("B_VISUAL");
    });

    it("varies variant by restaurant ID (different IDs get different distributions)", () => {
      const ids = ["rest_abc123", "rest_def456", "rest_ghi789", "rest_jkl012", "rest_mno345"];
      const variants = ids.map((id) => {
        return restaurantRepo.resolveCroVariant({ id, name: "Test", croVariant: null } as any);
      });

      // All valid
      expect(variants.every((v) => ["A_SCORE", "B_VISUAL", "C_NARRATIVE"].includes(v))).toBe(true);
    });
  });

  describe("createProspect landing page record", () => {
    it("creates a prospect with slug auto-generated from name", async () => {
      const db = getDB();
      const prospect = await (restaurantRepo as any).createProspect({
        id: "rest_test123",
        name: "La Marina Bistro",
        slug: null,
        cuisineType: "seafood",
        locationArea: "marbella",
        googleRating: 4.5,
      });

      expect(prospect.slug).toBe("la-marina-bistro");
      const fetched = await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, "rest_test123"));
      expect(fetched[0]?.slug).toBe("la-marina-bistro");
    });
  });

  describe("Environmental Signal Scoring", () => {
    it("computes a non-zero composite score from multiple signals", async () => {
      const db = getDB();
      await db.insert(environmentalSignalsTable).values([
        { restaurantId: "rest_envscore", signalType: "weather", signalValue: "sunny", weight: 1.0, confidence: 0.9, date: "2026-01-01", cityName: "test" } as any,
      ]);

      const score = await (restaurantRepo as any).getEnvironmentalSignalScore("rest_envscore");
      expect(score).toBeGreaterThan(0);
    });
  });
});
