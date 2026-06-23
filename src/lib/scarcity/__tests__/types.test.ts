import { describe, it, expect } from "vitest";
import {
  MAX_SAAS_PER_AREA,
  MAX_AGENCY_PER_AREA,
  ScarcityCheckParamsSchema,
  EnrollmentRequestSchema,
  SCARCITY_ERROR_MESSAGE,
} from "@/lib/scarcity/types";

describe("Scarcity Constants", () => {
  it("defines max 2 SaaS per area", () => {
    expect(MAX_SAAS_PER_AREA).toBe(2);
  });

  it("defines max 1 Agency per area", () => {
    expect(MAX_AGENCY_PER_AREA).toBe(1);
  });
});

describe("SCARCITY_ERROR_MESSAGE", () => {
  it("includes cuisine and area in the message", () => {
    const msg = SCARCITY_ERROR_MESSAGE("Italian", "Downtown");
    expect(msg).toContain("Italian");
    expect(msg).toContain("Downtown");
  });

  it("mentions the limits", () => {
    const msg = SCARCITY_ERROR_MESSAGE("French", "Midtown");
    expect(msg).toContain("2 SaaS");
    expect(msg).toContain("1 Agency");
  });
});

describe("ScarcityCheckParamsSchema", () => {
  it("accepts valid parameters", () => {
    const result = ScarcityCheckParamsSchema.safeParse({
      cuisineType: "Italian",
      locationArea: "Downtown",
    });
    expect(result.success).toBe(true);
  });

  it("trims whitespace", () => {
    const result = ScarcityCheckParamsSchema.safeParse({
      cuisineType: "  Italian  ",
      locationArea: "  Downtown  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cuisineType).toBe("Italian");
      expect(result.data.locationArea).toBe("Downtown");
    }
  });

  it("rejects empty cuisineType", () => {
    const result = ScarcityCheckParamsSchema.safeParse({
      cuisineType: "",
      locationArea: "Downtown",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty locationArea", () => {
    const result = ScarcityCheckParamsSchema.safeParse({
      cuisineType: "Italian",
      locationArea: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects overly long cuisineType", () => {
    const result = ScarcityCheckParamsSchema.safeParse({
      cuisineType: "A".repeat(101),
      locationArea: "Downtown",
    });
    expect(result.success).toBe(false);
  });

  it("rejects overly long locationArea", () => {
    const result = ScarcityCheckParamsSchema.safeParse({
      cuisineType: "Italian",
      locationArea: "A".repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing fields", () => {
    const result = ScarcityCheckParamsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("EnrollmentRequestSchema", () => {
  it("accepts valid SaaS enrollment", () => {
    const result = EnrollmentRequestSchema.safeParse({
      restaurantId: "rest_abc123",
      tier: "saas",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid Agency enrollment", () => {
    const result = EnrollmentRequestSchema.safeParse({
      restaurantId: "rest_xyz789",
      tier: "agency",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid restaurantId format", () => {
    const result = EnrollmentRequestSchema.safeParse({
      restaurantId: "bad-id",
      tier: "saas",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid tier", () => {
    const result = EnrollmentRequestSchema.safeParse({
      restaurantId: "rest_abc123",
      tier: "premium",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing restaurantId", () => {
    const result = EnrollmentRequestSchema.safeParse({
      tier: "saas",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty restaurantId", () => {
    const result = EnrollmentRequestSchema.safeParse({
      restaurantId: "",
      tier: "saas",
    });
    expect(result.success).toBe(false);
  });
});