import { describe, it, expect } from "vitest";
import {
  BrandPersonaInputSchema,
  BrandPersonaFullSchema,
  BrandPersonaFragmentSchema,
  VOICE_PRESETS,
} from "@/lib/brand-persona/types";

describe("BrandPersonaInputSchema", () => {
  it("accepts valid complete input", () => {
    const result = BrandPersonaInputSchema.safeParse({
      cuisinePhilosophy: "Fresh seafood.",
      voice: "Warm & Welcoming",
      targetCustomer: ["Couples", "Tourists"],
      neighborhoodCharacter: "Seaside, historic",
      values: "Welcome.",
    });

    expect(result.success).toBe(true);
  });

  it("accepts empty/optional fields with defaults", () => {
    const result = BrandPersonaInputSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cuisinePhilosophy).toBe("");
      expect(result.data.voice).toBe("");
      expect(result.data.targetCustomer).toEqual([]);
      expect(result.data.neighborhoodCharacter).toBe("");
      expect(result.data.values).toBe("");
    }
  });

  it("trims whitespace from string fields", () => {
    const result = BrandPersonaInputSchema.safeParse({
      cuisinePhilosophy: "  Fresh fish.  ",
      voice: "  Bold  ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cuisinePhilosophy).toBe("Fresh fish.");
      expect(result.data.voice).toBe("Bold");
    }
  });

  it("rejects overly long cuisinePhilosophy", () => {
    const result = BrandPersonaInputSchema.safeParse({
      cuisinePhilosophy: "A".repeat(501),
    });

    expect(result.success).toBe(false);
  });
});

describe("BrandPersonaFullSchema", () => {
  it("accepts a valid v1 persona document", () => {
    const result = BrandPersonaFullSchema.safeParse({
      version: 1,
      created_at: "2026-06-20T00:00:00Z",
      updated_at: "2026-06-20T00:00:00Z",
      cuisine_philosophy: "Fresh seafood.",
      voice: "Warm & Welcoming",
      target_customer: ["Couples"],
      neighborhood_character: "Seaside",
      values: "Welcome.",
      metadata: {
        generated_by: "onboarding-wizard",
        restaurant_slug: "test-slug",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects version != 1", () => {
    const result = BrandPersonaFullSchema.safeParse({
      version: 2,
      created_at: "2026-06-20T00:00:00Z",
      updated_at: "2026-06-20T00:00:00Z",
      cuisine_philosophy: "",
      voice: "",
      target_customer: [],
      neighborhood_character: "",
      values: "",
      metadata: { generated_by: "onboarding-wizard", restaurant_slug: "slug" },
    });

    expect(result.success).toBe(false);
  });
});

describe("BrandPersonaFragmentSchema", () => {
  it("accepts a valid fragment", () => {
    const result = BrandPersonaFragmentSchema.safeParse({
      v: 1,
      voice: "Warm",
      cuisine_philosophy: "Fresh.",
      target_customer: ["Couples"],
      neighborhood_character: "Seaside",
      values: "Welcome.",
      _total_tokens: 100,
    });

    expect(result.success).toBe(true);
  });

  it("rejects fragment exceeding 500 total tokens", () => {
    const result = BrandPersonaFragmentSchema.safeParse({
      v: 1,
      voice: "Warm",
      cuisine_philosophy: "Fresh.",
      target_customer: [],
      neighborhood_character: "Seaside",
      values: "Welcome.",
      _total_tokens: 501,
    });

    expect(result.success).toBe(false);
  });
});

describe("VOICE_PRESETS", () => {
  it("includes the four expected presets", () => {
    expect(VOICE_PRESETS).toContain("Warm & Welcoming");
    expect(VOICE_PRESETS).toContain("Bold & Passionate");
    expect(VOICE_PRESETS).toContain("Elegant & Refined");
    expect(VOICE_PRESETS).toContain("Rustic & Authentic");
  });
});