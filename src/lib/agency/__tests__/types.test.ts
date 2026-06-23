import { describe, it, expect } from "vitest";
import {
  MAX_AGENCY_GLOBAL,
  AgencyEnrollmentSchema,
  AGENCY_CAPACITY_MESSAGE,
} from "@/lib/agency/types";

describe("Agency Constants", () => {
  it("defines max 20 Agency clients globally", () => {
    expect(MAX_AGENCY_GLOBAL).toBe(20);
  });
});

describe("AGENCY_CAPACITY_MESSAGE", () => {
  it("mentions the capacity limit", () => {
    expect(AGENCY_CAPACITY_MESSAGE).toContain("20 clients");
  });

  it("mentions contacting the founder", () => {
    expect(AGENCY_CAPACITY_MESSAGE).toContain("founder");
  });
});

describe("AgencyEnrollmentSchema", () => {
  it("accepts valid restaurant ID", () => {
    const result = AgencyEnrollmentSchema.safeParse({
      restaurantId: "rest_abc123",
    });
    expect(result.success).toBe(true);
  });

  it("accepts numeric restaurant ID", () => {
    const result = AgencyEnrollmentSchema.safeParse({
      restaurantId: "rest_123456789",
    });
    expect(result.success).toBe(true);
  });

  it("accepts mixed alphanumeric restaurant ID", () => {
    const result = AgencyEnrollmentSchema.safeParse({
      restaurantId: "rest_a1b2c3d4e5",
    });
    expect(result.success).toBe(true);
  });

  it("rejects restaurant ID without rest_ prefix", () => {
    const result = AgencyEnrollmentSchema.safeParse({
      restaurantId: "abc123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty restaurant ID", () => {
    const result = AgencyEnrollmentSchema.safeParse({
      restaurantId: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects restaurant ID with special characters", () => {
    const result = AgencyEnrollmentSchema.safeParse({
      restaurantId: "rest_abc-def!",
    });
    expect(result.success).toBe(false);
  });

  it("rejects restaurant ID with spaces", () => {
    const result = AgencyEnrollmentSchema.safeParse({
      restaurantId: "rest_abc 123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing fields", () => {
    const result = AgencyEnrollmentSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects non-string restaurantId", () => {
    const result = AgencyEnrollmentSchema.safeParse({
      restaurantId: 12345,
    });
    expect(result.success).toBe(false);
  });
});