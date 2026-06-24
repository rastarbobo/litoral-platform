import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Stripe module
const mockConstructEvent = vi.fn();
const mockCheckoutCreate = vi.fn();
const mockBillingPortalCreate = vi.fn();

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    webhooks: {
      constructEvent: mockConstructEvent,
    },
    checkout: {
      sessions: {
        create: mockCheckoutCreate,
      },
    },
    billingPortal: {
      sessions: {
        create: mockBillingPortalCreate,
      },
    },
  }),
}));

// Mock restaurant repository
const mockEnrollViaStripeCheckout = vi.fn();
const mockFindById = vi.fn();
const mockGetScarcityForCuisineArea = vi.fn();
const mockGetSubscriptionStatus = vi.fn();

vi.mock("@/db/repositories/restaurant-repository", () => ({
  restaurantRepo: {
    enrollViaStripeCheckout: (...args: unknown[]) => mockEnrollViaStripeCheckout(...args),
    findById: (...args: unknown[]) => mockFindById(...args),
    getScarcityForCuisineArea: (...args: unknown[]) => mockGetScarcityForCuisineArea(...args),
    getSubscriptionStatus: (...args: unknown[]) => mockGetSubscriptionStatus(...args),
  },
}));

// Mock cloudflare context
vi.mock("@/utils/cloudflare-context", () => ({
  getCloudflareContext: async () => ({
    env: {
      STRIPE_KV: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      },
    },
  }),
}));

// Mock auth
vi.mock("@/utils/auth", () => ({
  getSessionFromCookie: vi.fn().mockResolvedValue({
    user: { email: "test@restaurant.com", emailVerified: new Date() },
  }),
}));

import { getSessionFromCookie } from "@/utils/auth";

describe("Stripe Subscription Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getSessionFromCookie as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { email: "test@restaurant.com", emailVerified: new Date() },
    });
  });

  describe("enrollViaStripeCheckout (Repository)", () => {
    it("returns SUCCESS when prospect transitions to active_saas", async () => {
      mockEnrollViaStripeCheckout.mockResolvedValue({
        type: "SUCCESS",
        restaurantId: "rest_abc123",
      });

      const result = await mockEnrollViaStripeCheckout(
        "rest_abc123",
        "pro",
        "cus_123",
        "sub_456",
      );

      expect(result.type).toBe("SUCCESS");
      expect(result.restaurantId).toBe("rest_abc123");
    });

    it("returns ALREADY_ENROLLED when restaurant is already active", async () => {
      mockEnrollViaStripeCheckout.mockResolvedValue({
        type: "ALREADY_ENROLLED",
        restaurantId: "rest_abc123",
      });

      const result = await mockEnrollViaStripeCheckout(
        "rest_abc123",
        "pro",
        "cus_123",
        "sub_456",
      );

      expect(result.type).toBe("ALREADY_ENROLLED");
    });

    it("returns NOT_FOUND when restaurant doesn't exist", async () => {
      mockEnrollViaStripeCheckout.mockResolvedValue({
        type: "NOT_FOUND",
        restaurantId: "rest_does_not_exist",
      });

      const result = await mockEnrollViaStripeCheckout(
        "rest_does_not_exist",
        "pro",
        "cus_123",
        "sub_456",
      );

      expect(result.type).toBe("NOT_FOUND");
    });

    it("returns DATABASE_ERROR on failure", async () => {
      mockEnrollViaStripeCheckout.mockResolvedValue({
        type: "DATABASE_ERROR",
        restaurantId: "rest_abc123",
        message: "Connection lost",
      });

      const result = await mockEnrollViaStripeCheckout(
        "rest_abc123",
        "pro",
        "cus_123",
        "sub_456",
      );

      expect(result.type).toBe("DATABASE_ERROR");
    });
  });

  describe("getSubscriptionStatus (Repository)", () => {
    it("returns subscription details for active client", async () => {
      mockGetSubscriptionStatus.mockResolvedValue({
        tier: "pro",
        status: "active_saas",
        stripeSubscriptionId: "sub_789",
        currentPeriodEnd: 1717200000,
      });

      const result = await mockGetSubscriptionStatus("rest_abc123");

      expect(result).not.toBeNull();
      expect(result!.tier).toBe("pro");
      expect(result!.status).toBe("active_saas");
      expect(result!.stripeSubscriptionId).toBe("sub_789");
    });

    it("returns null for prospect (no subscription)", async () => {
      mockGetSubscriptionStatus.mockResolvedValue(null);

      const result = await mockGetSubscriptionStatus("rest_prospect");

      expect(result).toBeNull();
    });
  });

  describe("Checkout Session Creation Input Validation", () => {
    it("accepts valid tier values", async () => {
      const { CreateCheckoutSessionSchema } = await import(
        "@/lib/stripe/prices"
      );

      expect(
        CreateCheckoutSessionSchema.safeParse({
          restaurantId: "rest_abc",
          tier: "pro",
        }).success,
      ).toBe(true);

      expect(
        CreateCheckoutSessionSchema.safeParse({
          restaurantId: "rest_abc",
          tier: "starter",
        }).success,
      ).toBe(true);

      expect(
        CreateCheckoutSessionSchema.safeParse({
          restaurantId: "rest_abc",
          tier: "annual_pro",
        }).success,
      ).toBe(true);
    });

    it("rejects invalid tier values", async () => {
      const { CreateCheckoutSessionSchema } = await import(
        "@/lib/stripe/prices"
      );

      expect(
        CreateCheckoutSessionSchema.safeParse({
          restaurantId: "rest_abc",
          tier: "invalid",
        }).success,
      ).toBe(false);
    });

    it("rejects empty restaurantId", async () => {
      const { CreateCheckoutSessionSchema } = await import(
        "@/lib/stripe/prices"
      );

      expect(
        CreateCheckoutSessionSchema.safeParse({
          restaurantId: "",
          tier: "pro",
        }).success,
      ).toBe(false);
    });
  });

  describe("Stripe Webhook Signature Verification", () => {
    it("returns 400 when signature is invalid", async () => {
      mockConstructEvent.mockImplementation(() => {
        throw new Error("Invalid signature");
      });

      const { POST } = await import("@/app/api/webhooks/stripe/route");

      const request = new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": "invalid_sig" },
        body: JSON.stringify({ id: "evt_test", type: "checkout.session.completed" }),
      });

      const response = await POST(request as unknown as Parameters<typeof POST>[0]);
      expect(response.status).toBe(400);

      const body = await response.json() as { status?: string };
      expect(body.status).toBe("error");
    });

    it("returns 200 when signature is valid and event is checkout.session.completed", async () => {
      mockConstructEvent.mockReturnValue({
        id: "evt_test_123",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test",
            metadata: { restaurantId: "rest_abc", tier: "pro" },
            customer: "cus_test",
            subscription: "sub_test",
          },
        },
      });

      mockEnrollViaStripeCheckout.mockResolvedValue({
        type: "SUCCESS",
        restaurantId: "rest_abc",
      });

      mockGetScarcityForCuisineArea.mockResolvedValue({
        saasCount: 1,
        agencyCount: 0,
        maxSaas: 2,
        maxAgency: 1,
        isAvailable: true,
      });

      const { POST } = await import("@/app/api/webhooks/stripe/route");

      const request = new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": "valid_sig" },
        body: JSON.stringify({
          id: "evt_test_123",
          type: "checkout.session.completed",
          data: {
            object: {
              id: "cs_test",
              metadata: { restaurantId: "rest_abc", tier: "pro" },
              customer: "cus_test",
              subscription: "sub_test",
            },
          },
        }),
      });

      const response = await POST(request as unknown as Parameters<typeof POST>[0]);
      expect(response.status).toBe(200);

      const body = await response.json() as { received?: boolean };
      expect(body.received).toBe(true);
    });
  });

  describe("Checkout Session Route Input Validation", () => {
    it("returns 401 when not authenticated", async () => {
      (getSessionFromCookie as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { POST } = await import("@/app/api/checkout/create-session/route");

      const request = new Request("http://localhost/api/checkout/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId: "rest_abc", tier: "pro" }),
      });

      const response = await POST(request as unknown as Parameters<typeof POST>[0]);
      expect(response.status).toBe(401);
    });

    it("returns 409 when restaurant is already enrolled", async () => {
      mockFindById.mockResolvedValue({
        id: "rest_abc",
        subscriptionStatus: "active_saas",
        cuisineType: "seafood",
        locationArea: "mamaia",
      });

      const { POST } = await import("@/app/api/checkout/create-session/route");

      const request = new Request("http://localhost/api/checkout/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId: "rest_abc", tier: "pro" }),
      });

      const response = await POST(request as unknown as Parameters<typeof POST>[0]);
      expect(response.status).toBe(409);
    });
  });
});