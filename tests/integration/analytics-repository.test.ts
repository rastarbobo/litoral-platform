import { describe, it, expect, beforeEach } from "vitest";
import { analyticsRepo } from "@/db/repositories/analytics-repository";
import { getDB } from "@/db";
import { analyticsEventsTable, prospectEventsTable, restaurantsTable } from "@/db/schema";
import { createId } from "@paralleldrive/cuid2";

describe("Analytics Repository Integration", () => {
  beforeEach(async () => {
    const db = getDB();
    await db.delete(analyticsEventsTable);
    await db.delete(prospectEventsTable);
    await db.delete(restaurantsTable);
  });

  it("should record an analytics event correctly", async () => {
    const db = getDB();
    
    // Setup a prospect
    const prospectId = `rest_${createId()}`;
    await db.insert(restaurantsTable).values({
      id: prospectId,
      name: "Test Restaurant Analytics",
    });

    const result = await analyticsRepo.recordEvent(prospectId, "scroll", { scroll_depth: 50 });
    
    expect(result.error).toBeUndefined();
    expect(result.data).toBeDefined();
    expect(result.data?.prospectId).toBe(prospectId);
    expect(result.data?.eventType).toBe("scroll");
    expect((result.data?.metadata as any).scroll_depth).toBe(50);
  });

  it("should generate a weekly cohort report highlighting the weakest tier", async () => {
    const db = getDB();
    
    // Setup a prospect
    const prospectId = `rest_${createId()}`;
    await db.insert(restaurantsTable).values({
      id: prospectId,
      name: "Test Cohort Restaurant",
    });

    // Create 5 engagement events
    for (let i = 0; i < 5; i++) {
      await analyticsRepo.recordEvent(prospectId, "page_visit");
    }

    // Create 1 reply event (conversion proxy)
    await db.insert(prospectEventsTable).values({
      prospectId,
      fromState: 2,
      toState: 3,
      trigger: "reply",
    });

    // We do NOT create any state 6 events (revenue), so revenue should be the lowest performing tier.

    const reportResult = await analyticsRepo.generateWeeklyCohortReport();
    
    expect(reportResult.error).toBeUndefined();
    expect(reportResult.data).toBeDefined();
    
    const report = reportResult.data!;
    expect(report.metrics.engagement).toBe(5);
    expect(report.metrics.conversion).toBe(1);
    expect(report.metrics.revenue).toBe(0);

    // Because revenue is 0, it should be flagged as underperforming
    expect(report.recommendation.underperformingTier).toBe("Revenue");
    expect(report.recommendation.action).toContain("Check closing strategies");
  });
});
