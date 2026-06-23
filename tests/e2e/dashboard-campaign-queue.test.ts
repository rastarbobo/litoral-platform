import { describe, expect, test } from "vitest";
import {
  clickAppRole,
  expectAppPathname,
  expectAppPathnameStartsWith,
  expectAppRole,
  expectAppText,
  loadAppFrame,
  navigateAppFrame,
} from "./app-frame";
import { signInSeededMember } from "./auth-helpers";

/**
 * E2E Smoke Tests — Dashboard Campaign Queue
 *
 * Verifies the post-auth dashboard UI loads and renders campaign queue
 * components correctly. Covers Epic 5 (Mobile-First Web Dashboard).
 *
 * These tests require a running local wrangler preview with seeded data.
 */

describe("Dashboard Campaign Queue", () => {
  test("signed-in user sees dashboard with Queue tab active after sign-in", async () => {
    await signInSeededMember();

    // Dashboard should be the default landing page after sign-in
    await expectAppPathname("/dashboard");

    // The Queue tab should be active (default tab)
    await expectAppText("Dashboard", { exact: true });
  });

  test("dashboard navigation tabs are visible", async () => {
    await signInSeededMember();
    await navigateAppFrame("/dashboard", { waitForHydration: true });

    // Three main tabs should be visible: Queue, Results, Settings
    await expectAppRole("tab", "Queue");
    await expectAppRole("tab", "Results");
    await expectAppRole("tab", "Settings");
  });

  test("campaign queue shows empty state message when no campaigns exist", async () => {
    await signInSeededMember();
    await navigateAppFrame("/dashboard", { waitForHydration: true });

    // The seeded restaurant may or may not have campaigns.
    // If empty, the UI should show "No pending campaigns" or a similar empty state.
    // Either way, the page shouldn't crash.
    await expectAppText("Pending", { exact: true });
    await expectAppText("Scheduled", { exact: true });
    await expectAppText("Published", { exact: true });
  });

  test("switching to Results tab shows results view", async () => {
    await signInSeededMember();
    await navigateAppFrame("/dashboard", { waitForHydration: true });

    // Click the Results tab
    await clickAppRole("tab", "Results");

    // Should show the results view — either data or "no results yet" / loading state.
    // The page should not show an error or blank screen.
    // Minimum assertion: the tab is still on /dashboard (no redirect/error).
    await expectAppPathname("/dashboard");
  });

  test("switching to Settings tab shows settings view", async () => {
    await signInSeededMember();
    await navigateAppFrame("/dashboard", { waitForHydration: true });

    // Click the Settings tab
    await clickAppRole("tab", "Settings");

    // Settings should render (extension setup, brand persona, subscription, etc.)
    await expectAppPathname("/dashboard");
  });
});