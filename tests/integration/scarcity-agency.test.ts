/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDB } from "@/db";
import { restaurantsTable } from "@/db/schema";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { eq } from "drizzle-orm";
import { MAX_AGENCY_GLOBAL } from "@/lib/agency/types";

/**
 * Integration tests for One-Per-Town Scarcity Enforcement (Epic 3, Story 3.3)
 * and Agency Tier Capacity Constraints (Epic 3, Story 3.5).
 *
 * Coverage:
 * - checkScarcityAndEnroll: successful enrollment within quota
 * - checkScarcityAndEnroll: rejection when SaaS quota is full (max 2)
 * - checkScarcityAndEnroll: triggeredCompetitorActivation flag
 * - checkScarcityAndEnroll: ALREADY_ENROLLED guard
 * - getScarcityForCuisineArea: correct counts for SaaS/Agency
 * - checkAgencyCapacityAndEnroll: successful enrollment
 * - checkAgencyCapacityAndEnroll: rejection when global agency cap hit
 * - getAgencyCapacityState: correct global state
 * - TOCTOU prevention: atomic conditional UPDATE
 */

const CUISINE = "korean";
const AREA = "gangnam";

function makeProspect(id: string, slug: string) {
  return {
    id,
    name: `Restaurant ${id}`,
    slug,
    cuisineType: CUISINE,
    locationArea: AREA,
    subscriptionStatus: "prospect" as const,
    googleRating: 4.0,
    reviewCount: 30,
    qualificationStatus: "qualified" as const,
    behavioralState: 0,
  };
}

const REST_A = "rest_scarcity_a";
const REST_B = "rest_scarcity_b";
const REST_C = "rest_scarcity_c";
const REST_AGENCY = "rest_agency_test";

const testRestaurants = [
  makeProspect(REST_A, "scarcity-a"),
  makeProspect(REST_B, "scarcity-b"),
  makeProspect(REST_C, "scarcity-c"),
  makeProspect(REST_AGENCY, "agency-test"),
];

describe("One-Per-Town Scarcity + Agency Capacity Integration", () => {
  beforeEach(async () => {
    const db = getDB();
    // Clean up all test restaurants
    for (const r of testRestaurants) {
      await db.delete(restaurantsTable).where(eq(restaurantsTable.id, r.id));
    }
    // Seed all four
    for (const r of testRestaurants) {
      await db.insert(restaurantsTable).values(r);
    }
  });

  afterEach(async () => {
    const db = getDB();
    for (const r of testRestaurants) {
      await db.delete(restaurantsTable).where(eq(restaurantsTable.id, r.id));
    }
  });

  // ─── SaaS Scarcity: checkScarcityAndEnroll ──────────────────

  describe("checkScarcityAndEnroll (SaaS)", () => {
    it("successfully enrolls first restaurant (0→1)", async () => {
      const result = await restaurantRepo.checkScarcityAndEnroll(
        REST_A,
        CUISINE,
        AREA,
        "saas",
      );

      expect(result.type).toBe("SUCCESS");
      expect((result as { triggeredCompetitorActivation: boolean }).triggeredCompetitorActivation)
        .toBe(false);

      // Verify state
      const db = getDB();
      const updated = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, REST_A),
      });
      expect(updated!.subscriptionStatus).toBe("active_saas");
    });

    it("successfully enrolls second restaurant (1→2) with competitor trigger", async () => {
      // Enroll first
      await restaurantRepo.checkScarcityAndEnroll(REST_A, CUISINE, AREA, "saas");

      // Enroll second — should trigger competitor activation (2nd slot fills)
      const result = await restaurantRepo.checkScarcityAndEnroll(
        REST_B,
        CUISINE,
        AREA,
        "saas",
      );

      expect(result.type).toBe("SUCCESS");
      expect((result as { triggeredCompetitorActivation: boolean }).triggeredCompetitorActivation)
        .toBe(true);
    });

    it("rejects third restaurant when SaaS quota is full (2/2)", async () => {
      // Fill both slots
      await restaurantRepo.checkScarcityAndEnroll(REST_A, CUISINE, AREA, "saas");
      await restaurantRepo.checkScarcityAndEnroll(REST_B, CUISINE, AREA, "saas");

      // Third attempt should fail
      const result = await restaurantRepo.checkScarcityAndEnroll(
        REST_C,
        CUISINE,
        AREA,
        "saas",
      );

      expect(result.type).toBe("SCARCITY_FULL");
      expect((result as { saasCount: number }).saasCount).toBe(2);
      expect((result as { tier: string }).tier).toBe("saas");
    });

    it("returns ALREADY_ENROLLED when same restaurant tries twice", async () => {
      await restaurantRepo.checkScarcityAndEnroll(REST_A, CUISINE, AREA, "saas");

      const result = await restaurantRepo.checkScarcityAndEnroll(
        REST_A,
        CUISINE,
        AREA,
        "saas",
      );

      expect(result.type).toBe("ALREADY_ENROLLED");
    });

    it("returns NOT_FOUND for non-existent restaurant", async () => {
      const result = await restaurantRepo.checkScarcityAndEnroll(
        "rest_nonexistent",
        CUISINE,
        AREA,
        "saas",
      );

      expect(result.type).toBe("NOT_FOUND");
    });

    it("only counts same cuisine+area combination", async () => {
      // Enroll a restaurant in a DIFFERENT cuisine/area
      const db = getDB();
      const otherId = "rest_other_cuisine";
      await db.delete(restaurantsTable).where(eq(restaurantsTable.id, otherId));
      await db.insert(restaurantsTable).values({
        ...makeProspect(otherId, "other-cuisine"),
        cuisineType: "japanese",
        locationArea: "shibuya",
      });

      await restaurantRepo.checkScarcityAndEnroll(otherId, "japanese", "shibuya", "saas");

      // Korean/Gangnam should still be at 0
      const scarcity = await restaurantRepo.getScarcityForCuisineArea(CUISINE, AREA, "saas");
      expect(scarcity.saasCount).toBe(0);
      expect(scarcity.isAvailable).toBe(true);
    });
  });

  // ─── Scarcity State Query ────────────────────────────────────

  describe("getScarcityForCuisineArea", () => {
    it("returns correct counts after enrollment", async () => {
      const before = await restaurantRepo.getScarcityForCuisineArea(CUISINE, AREA);
      expect(before.saasCount).toBe(0);
      expect(before.agencyCount).toBe(0);
      expect(before.isAvailable).toBe(true);

      // Enroll 1 SaaS
      await restaurantRepo.checkScarcityAndEnroll(REST_A, CUISINE, AREA, "saas");

      const after = await restaurantRepo.getScarcityForCuisineArea(CUISINE, AREA, "saas");
      expect(after.saasCount).toBe(1);
      expect(after.agencyCount).toBe(0);
      expect(after.maxSaas).toBe(2);
      expect(after.maxAgency).toBe(1);
      expect(after.isAvailable).toBe(true); // still room for 1 more SaaS or 1 Agency
    });

    it("reports isAvailable=false when SaaS quota is full", async () => {
      await restaurantRepo.checkScarcityAndEnroll(REST_A, CUISINE, AREA, "saas");
      await restaurantRepo.checkScarcityAndEnroll(REST_B, CUISINE, AREA, "saas");

      const scarcity = await restaurantRepo.getScarcityForCuisineArea(CUISINE, AREA, "saas");
      expect(scarcity.saasCount).toBe(2);
      expect(scarcity.isAvailable).toBe(false); // no more SaaS slots
    });

    it("shows isAvailable=true for Agency even when SaaS is full", async () => {
      await restaurantRepo.checkScarcityAndEnroll(REST_A, CUISINE, AREA, "saas");
      await restaurantRepo.checkScarcityAndEnroll(REST_B, CUISINE, AREA, "saas");

      const scarcity = await restaurantRepo.getScarcityForCuisineArea(CUISINE, AREA, "agency");
      expect(scarcity.agencyCount).toBe(0);
      expect(scarcity.isAvailable).toBe(true); // Agency slot still open
    });
  });

  // ─── Agency Global Capacity: checkAgencyCapacityAndEnroll ────

  describe("checkAgencyCapacityAndEnroll", () => {
    it("successfully enrolls into Agency tier when under global cap", async () => {
      const result = await restaurantRepo.checkAgencyCapacityAndEnroll(REST_AGENCY);

      expect(result.type).toBe("SUCCESS");

      const db = getDB();
      const updated = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, REST_AGENCY),
      });
      expect(updated!.subscriptionStatus).toBe("active_agency");
    });

    it("returns ALREADY_ENROLLED when same restaurant re-enrolls", async () => {
      await restaurantRepo.checkAgencyCapacityAndEnroll(REST_AGENCY);

      const result = await restaurantRepo.checkAgencyCapacityAndEnroll(REST_AGENCY);
      expect(result.type).toBe("ALREADY_ENROLLED");
    });

    it("returns NOT_FOUND for non-existent restaurant", async () => {
      const result = await restaurantRepo.checkAgencyCapacityAndEnroll("rest_nonexistent");
      expect(result.type).toBe("NOT_FOUND");
    });

    it("rejects enrollment when global agency cap is reached", async () => {
      // Fill agency slots up to MAX_AGENCY_GLOBAL
      const db = getDB();

      // Create enough restaurants to fill agency capacity
      // const agencyProspects = [];
      for (let i = 0; i < MAX_AGENCY_GLOBAL; i++) {
        const id = `rest_agency_fill_${i}`;
        await db.delete(restaurantsTable).where(eq(restaurantsTable.id, id));
        await db.insert(restaurantsTable).values({
          id,
          name: `Agency Fill ${i}`,
          slug: `agency-fill-${i}`,
          cuisineType: `cuisine-${i}`,
          locationArea: `area-${i}`,
          subscriptionStatus: "active_agency", // pre-enrolled
          googleRating: 4.0,
          reviewCount: 30,
          qualificationStatus: "qualified",
          behavioralState: 0,
        });
      }

      // Try enrolling our test restaurant — should fail
      const result = await restaurantRepo.checkAgencyCapacityAndEnroll(REST_AGENCY);

      expect(result.type).toBe("AGENCY_CAPACITY_FULL");
      expect((result as { agencyCount: number }).agencyCount).toBe(MAX_AGENCY_GLOBAL);
    });
  });

  // ─── Agency Global State Query ──────────────────────────────

  describe("getAgencyCapacityState", () => {
    it("returns correct global agency capacity state", async () => {
      const state = await restaurantRepo.getAgencyCapacityState();

      expect(state).toHaveProperty("agencyCount");
      expect(state).toHaveProperty("maxAgency");
      expect(state).toHaveProperty("isAvailable");
      expect(state.maxAgency).toBe(MAX_AGENCY_GLOBAL);
      expect(typeof state.isAvailable).toBe("boolean");
    });

    it("isAvailable decreases after agency enrollment", async () => {
      const before = await restaurantRepo.getAgencyCapacityState();

      await restaurantRepo.checkAgencyCapacityAndEnroll(REST_AGENCY);

      const after = await restaurantRepo.getAgencyCapacityState();
      expect(after.agencyCount).toBe(before.agencyCount + 1);

      if (before.agencyCount + 1 >= MAX_AGENCY_GLOBAL) {
        expect(after.isAvailable).toBe(false);
      }
    });
  });

  // ─── TOCTOU Prevention ──────────────────────────────────────

  describe("TOCTOU race prevention", () => {
    it("only one concurrent SaaS enrollment fills the last slot", async () => {
      // Fill one slot first
      await restaurantRepo.checkScarcityAndEnroll(REST_A, CUISINE, AREA, "saas");

      // Try to fill the last slot with TWO concurrent calls
      const [r1, r2] = await Promise.all([
        restaurantRepo.checkScarcityAndEnroll(REST_B, CUISINE, AREA, "saas"),
        restaurantRepo.checkScarcityAndEnroll(REST_C, CUISINE, AREA, "saas"),
      ]);

      const successes = [r1, r2].filter((r) => r.type === "SUCCESS");
      expect(successes.length).toBe(1); // only one wins the atomic race

      const failures = [r1, r2].filter((r) => r.type === "SCARCITY_FULL");
      expect(failures.length).toBe(1); // the other is scarcity-full

      // Verify final state: exactly 2 active SaaS
      const scarcity = await restaurantRepo.getScarcityForCuisineArea(CUISINE, AREA);
      expect(scarcity.saasCount).toBe(2);
      expect(scarcity.isAvailable).toBe(false);
    });

    it("atomic UPDATE prevents status overwrites on non-prospect rows", async () => {
      // Manually set REST_C to active_saas (simulating a concurrent webhook)
      const db = getDB();
      await db.update(restaurantsTable)
        .set({ subscriptionStatus: "active_saas" })
        .where(eq(restaurantsTable.id, REST_C));

      // Now try checkScarcityAndEnroll — should fail because it's not a prospect
      const result = await restaurantRepo.checkScarcityAndEnroll(
        REST_C,
        CUISINE,
        AREA,
        "saas",
      );

      expect(result.type).toBe("ALREADY_ENROLLED");
    });
  });

  // ─── Scarcity Signal for Landing Page ───────────────────────

  describe("landing page scarcity signal", () => {
    it("returns correct max values in public API format", async () => {
      const scarcity = await restaurantRepo.getScarcityForCuisineArea(CUISINE, AREA);

      expect(scarcity.maxSaas).toBe(2);
      expect(scarcity.maxAgency).toBe(1);
      expect(scarcity.saasCount).toBeGreaterThanOrEqual(0);
      expect(scarcity.agencyCount).toBeGreaterThanOrEqual(0);
      expect(scarcity.agencyCount).toBeLessThanOrEqual(1);
    });

    it("case-insensitive matching for cuisineType and locationArea", async () => {
      // Enroll with mixed case
      const db = getDB();
      const id = "rest_mixed_case";
      await db.delete(restaurantsTable).where(eq(restaurantsTable.id, id));
      await db.insert(restaurantsTable).values({
        ...makeProspect(id, "mixed-case"),
        cuisineType: "KoReAn",
        locationArea: "GaNgNaM",
      });

      await restaurantRepo.checkScarcityAndEnroll(id, "KoReAn", "GaNgNaM", "saas");

      // Query with different case — should still find it
      const scarcity = await restaurantRepo.getScarcityForCuisineArea("korean", "gangnam", "saas");
      expect(scarcity.saasCount).toBe(1); // normalized to lowercase in the DB query
    });
  });
});