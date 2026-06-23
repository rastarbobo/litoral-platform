import { describe, it, expect } from "vitest";
import { isUpgrade, TIER_ORDER, SUBSCRIPTION_TIERS } from "@/lib/subscription/tiers";

describe("Subscription Tiers", () => {
  describe("isUpgrade", () => {
    it("returns true when target is higher than current", () => {
      expect(isUpgrade("starter", "pro")).toBe(true);
      expect(isUpgrade("starter", "annual_pro")).toBe(true);
      expect(isUpgrade("pro", "annual_pro")).toBe(true);
    });

    it("returns false when target is lower than current", () => {
      expect(isUpgrade("pro", "starter")).toBe(false);
      expect(isUpgrade("annual_pro", "pro")).toBe(false);
      expect(isUpgrade("annual_pro", "starter")).toBe(false);
    });

    it("returns false when target equals current", () => {
      expect(isUpgrade("starter", "starter")).toBe(false);
      expect(isUpgrade("pro", "pro")).toBe(false);
      expect(isUpgrade("annual_pro", "annual_pro")).toBe(false);
    });

    it("returns true when current is null (no plan)", () => {
      expect(isUpgrade(null, "starter")).toBe(true);
      expect(isUpgrade(null, "pro")).toBe(true);
    });

    it("returns false for unknown tier keys", () => {
      expect(isUpgrade("starter", "unknown")).toBe(false);
      expect(isUpgrade("unknown", "pro")).toBe(false);
    });
  });

  describe("SUBSCRIPTION_TIERS", () => {
    it("has exactly 3 tiers", () => {
      expect(SUBSCRIPTION_TIERS).toHaveLength(3);
    });

    it("has tiers in correct order (starter < pro < annual_pro)", () => {
      const keys = SUBSCRIPTION_TIERS.map((t) => t.key);
      expect(keys).toEqual(["starter", "pro", "annual_pro"]);
    });

    it("all tiers have a name, price, and at least 3 features", () => {
      for (const tier of SUBSCRIPTION_TIERS) {
        expect(tier.name).toBeTruthy();
        expect(tier.price).toBeTruthy();
        expect(tier.features.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe("TIER_ORDER", () => {
    it("has 3 entries in ascending order", () => {
      expect(TIER_ORDER).toEqual(["starter", "pro", "annual_pro"]);
    });
  });
});