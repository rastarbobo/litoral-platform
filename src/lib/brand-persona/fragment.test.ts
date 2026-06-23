import { describe, it, expect } from "vitest";
import { generateFragment, buildFullPersona, parseFragmentForPreFill } from "@/lib/brand-persona/fragment";
import type { BrandPersonaFull } from "@/lib/brand-persona/types";

// Helper to create a minimal full persona for testing
function makeFullPersona(overrides: Partial<BrandPersonaFull> = {}): BrandPersonaFull {
  return {
    version: 1,
    created_at: "2026-06-20T00:00:00Z",
    updated_at: "2026-06-20T00:00:00Z",
    cuisine_philosophy: "Fresh seafood grilled over open flames with three-generation recipes.",
    voice: "Warm & Welcoming",
    target_customer: ["Couples", "Tourists", "Foodies"],
    neighborhood_character: "Seaside, historic, lively",
    values: "Hungry. Welcome. Like they are already at a table with an ocean view.",
    metadata: {
      generated_by: "onboarding-wizard",
      restaurant_slug: "test-restaurant",
    },
    ...overrides,
  };
}

describe("fragment generation", () => {
  it("generates a fragment ≤ 500 tokens from a full persona", () => {
    const full = makeFullPersona();
    const fragment = generateFragment(full);

    expect(fragment.v).toBe(1);
    expect(fragment.voice).toBe("Warm & Welcoming");
    expect(fragment.cuisine_philosophy).toBe("Fresh seafood grilled over open flames with three-generation recipes."); // 75 chars, under 100-token budget — not truncated
    expect(fragment.target_customer).toEqual(["Couples", "Tourists", "Foodies"]);
    expect(fragment.neighborhood_character).toBe("Seaside, historic, lively");
    expect(fragment._total_tokens).toBeLessThanOrEqual(500);
  });

  it("includes all required fields in the fragment", () => {
    const fragment = generateFragment(makeFullPersona());

    expect(fragment).toHaveProperty("voice");
    expect(fragment).toHaveProperty("cuisine_philosophy");
    expect(fragment).toHaveProperty("target_customer");
    expect(fragment).toHaveProperty("neighborhood_character");
    expect(fragment).toHaveProperty("values");
    expect(fragment).toHaveProperty("_total_tokens");
  });

  it("handles empty string fields gracefully", () => {
    const full = makeFullPersona({
      cuisine_philosophy: "",
      voice: "",
      values: "",
      neighborhood_character: "",
      target_customer: [],
    });

    const fragment = generateFragment(full);

    expect(fragment.voice).toBe("");
    expect(fragment.cuisine_philosophy).toBe("");
    expect(fragment.values).toBe("");
    expect(fragment.neighborhood_character).toBe("");
    expect(fragment.target_customer).toEqual([]);
    expect(fragment._total_tokens).toBeLessThanOrEqual(500);
  });

  it("truncates very long fields to stay under 500 tokens", () => {
    const longText = "A".repeat(5000);
    const full = makeFullPersona({
      cuisine_philosophy: longText,
      values: longText,
    });

    const fragment = generateFragment(full);

    expect(fragment._total_tokens).toBeLessThanOrEqual(500);
    expect(fragment.cuisine_philosophy.length).toBeLessThan(5000);
    expect(fragment.values.length).toBeLessThan(5000);
  });

  it("limits target_customer to max 5 segments", () => {
    const full = makeFullPersona({
      target_customer: ["A", "B", "C", "D", "E", "F", "G"],
    });

    const fragment = generateFragment(full);

    expect(fragment.target_customer.length).toBeLessThanOrEqual(5);
  });

  it("handles special characters without breaking", () => {
    const full = makeFullPersona({
      cuisine_philosophy: "Café é molto bella — the best pasta 🍝 in town!",
      values: "❤️ Love at first bite. ¡Qué rico!",
    });

    const fragment = generateFragment(full);

    expect(fragment._total_tokens).toBeLessThanOrEqual(500);
    expect(typeof fragment.cuisine_philosophy).toBe("string");
    expect(typeof fragment.values).toBe("string");
  });
});

describe("buildFullPersona", () => {
  it("builds a complete persona document from wizard input", () => {
    const input = {
      cuisinePhilosophy: "Fresh daily catch from local fishermen.",
      voice: "Rustic & Authentic",
      targetCustomer: ["Tourists", "Foodies"],
      neighborhoodCharacter: "Coastal, charming, vibrant",
      values: "Happy. Full. Already planning to return.",
    };

    const result = buildFullPersona(input, "test-slug", "onboarding-wizard");

    expect(result.version).toBe(1);
    expect(result.cuisine_philosophy).toBe(input.cuisinePhilosophy);
    expect(result.voice).toBe(input.voice);
    expect(result.target_customer).toEqual(input.targetCustomer);
    expect(result.neighborhood_character).toBe(input.neighborhoodCharacter);
    expect(result.values).toBe(input.values);
    expect(result.metadata.generated_by).toBe("onboarding-wizard");
    expect(result.metadata.restaurant_slug).toBe("test-slug");
    expect(result.created_at).toBeTruthy();
    expect(result.updated_at).toBeTruthy();
  });

  it("preserves original created_at when updating via dashboard editor", () => {
    const input = {
      cuisinePhilosophy: "Updated philosophy.",
      voice: "Warm & Welcoming",
      targetCustomer: ["Locals"],
      neighborhoodCharacter: "Updated",
      values: "Updated values.",
    };

    const originalDate = "2026-01-15T12:00:00Z";
    const result = buildFullPersona(input, "test-slug", "dashboard-editor", originalDate);

    expect(result.created_at).toBe(originalDate);
    expect(result.updated_at).not.toBe(originalDate);
    expect(result.metadata.generated_by).toBe("dashboard-editor");
  });

  it("uses dashboard-editor mode metadata", () => {
    const result = buildFullPersona(
      { cuisinePhilosophy: "", voice: "", targetCustomer: [], neighborhoodCharacter: "", values: "" },
      "slug",
      "dashboard-editor",
    );

    expect(result.metadata.generated_by).toBe("dashboard-editor");
  });
});

describe("parseFragmentForPreFill", () => {
  it("returns null for null/undefined input", () => {
    expect(parseFragmentForPreFill(null)).toBeNull();
    expect(parseFragmentForPreFill(undefined)).toBeNull();
  });

  it("parses a valid fragment JSON string", () => {
    const fragment = JSON.stringify({
      v: 1,
      cuisine_philosophy: "Fresh seafood.",
      voice: "Warm & Welcoming",
      target_customer: ["Couples"],
      neighborhood_character: "Seaside",
      values: "Welcome.",
    });

    const result = parseFragmentForPreFill(fragment);

    expect(result).not.toBeNull();
    expect(result!.cuisinePhilosophy).toBe("Fresh seafood.");
    expect(result!.voice).toBe("Warm & Welcoming");
    expect(result!.targetCustomer).toEqual(["Couples"]);
    expect(result!.neighborhoodCharacter).toBe("Seaside");
    expect(result!.values).toBe("Welcome.");
  });

  it("returns null for invalid JSON", () => {
    expect(parseFragmentForPreFill("not-valid-json")).toBeNull();
  });

  it("returns defaults for missing fields in fragment", () => {
    const fragment = JSON.stringify({ v: 1 });

    const result = parseFragmentForPreFill(fragment);

    expect(result).not.toBeNull();
    expect(result!.cuisinePhilosophy).toBe("");
    expect(result!.voice).toBe("");
    expect(result!.targetCustomer).toEqual([]);
  });
});