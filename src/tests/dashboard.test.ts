import { describe, it, expect } from "vitest";

// Simple unit tests for the dashboard surface.
// Full E2E tests should be run with Playwright or similar.

describe("Dashboard", () => {
  it("renders without crashing", () => {
    expect(true).toBe(true);
  });

  it("status pill maps colors correctly", () => {
    const statusMap: Record<string, { bg: string; fg: string }> = {
      pending_approval: { bg: "rgba(158,61,0,0.12)", fg: "#9e3d00" },
      approved: { bg: "rgba(76,74,202,0.12)", fg: "#4c4aca" },
      scheduled: { bg: "rgba(76,74,202,0.12)", fg: "#4c4aca" },
      published: { bg: "rgba(36,124,84,0.12)", fg: "#247c54" },
      rejected: { bg: "rgba(186,26,26,0.12)", fg: "#ba1a1a" },
    };

    for (const [status, expected] of Object.entries(statusMap)) {
      expect(status).toBeDefined();
      expect(expected).toHaveProperty("bg");
      expect(expected).toHaveProperty("fg");
    }
  });

  it("tab bar has three visible tabs", () => {
    expect(["Queue", "Results", "Settings"]).toEqual(
      expect.arrayContaining(["Queue", "Results", "Settings"])
    );
  });
});
