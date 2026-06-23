import { describe, expect, test, vi } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────

// Mock server-only (no-op in test environment)
vi.mock("server-only", () => ({}));

// Mock the getDB import — we're testing input validation, not database integration
vi.mock("@/db", () => ({
  getDB: vi.fn(() => ({
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          execute: vi.fn(() => Promise.resolve()),
        })),
      })),
    })),
    query: {
      restaurantsTable: {
        findFirst: vi.fn(() => Promise.resolve(null)),
      },
    },
  })),
}));

// Mock cloudflare:workers env
vi.mock("cloudflare:workers", () => ({
  env: {
    ONBOARDING_MAGIC_LINK_TTL_HOURS: undefined,
    NEXT_PUBLIC_APP_URL: "https://litoral.agency",
  },
}));

// Need to import after mocks are set up
describe("generateOnboardingMagicLink", () => {
  test("rejects empty restaurantSlug", async () => {
    const { generateOnboardingMagicLink } = await import("@/lib/onboarding/tokens");

    const result = await generateOnboardingMagicLink("");
    expect(result.data).toBeNull();
    expect(result.error).toBe("restaurantSlug must be a non-empty string");
  });

  test("rejects whitespace-only restaurantSlug", async () => {
    const { generateOnboardingMagicLink } = await import("@/lib/onboarding/tokens");

    const result = await generateOnboardingMagicLink("   ");
    expect(result.data).toBeNull();
    expect(result.error).toBe("restaurantSlug must be a non-empty string");
  });
});

describe("validateOnboardingToken", () => {
  test("rejects empty token", async () => {
    const { validateOnboardingToken } = await import("@/lib/onboarding/tokens");

    const result = await validateOnboardingToken("");
    expect(result.restaurant).toBeNull();
    expect(result.error).toBe("INVALID");
  });

  test("rejects whitespace-only token", async () => {
    const { validateOnboardingToken } = await import("@/lib/onboarding/tokens");

    const result = await validateOnboardingToken("   ");
    expect(result.restaurant).toBeNull();
    expect(result.error).toBe("INVALID");
  });
});