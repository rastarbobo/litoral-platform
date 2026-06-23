import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET as getQueue } from "./route";
import { POST as claimPost } from "./claim/route";
import { POST as scheduledPost } from "./scheduled/route";

// ─── Mocks ─────────────────────────────────────────────────

vi.mock("@/db", () => ({
  getDB: vi.fn(() => mockDB),
}));

vi.mock("@/db/repositories/campaign-repository", () => ({
  campaignRepo: {
    listApproved: vi.fn(),
    claimForScheduling: vi.fn(),
    markAsScheduled: vi.fn(),
  },
}));

import { campaignRepo } from "@/db/repositories/campaign-repository";

const mockDB: any = {
  query: {
    restaurantsTable: {
      findFirst: vi.fn(),
    },
  },
};

function createRequest(method: string, url: string, body?: object): Request {
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>) = { "Content-Type": "application/json" };
  }
  return new Request(url, init);
}

// ─── Tests: Story 6.2 — API Integration ────────────────────

describe("Story 6.2: Extension API Integration Tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── 10.9: POST /api/extension/queue/claim — first claim succeeds ──
  // ─── 10.10: POST /api/extension/queue/claim — unauthorized returns 401 ──
  describe("POST /api/extension/queue/claim", () => {
    it("10.9: first claim returns { claimed: true }, second returns { claimed: false }", async () => {
      (campaignRepo.claimForScheduling as any) = vi.fn()
        .mockResolvedValueOnce({ claimed: true })   // First call
        .mockResolvedValueOnce({ claimed: false }); // Second call (idempotent)

      mockDB.query.restaurantsTable.findFirst = vi.fn().mockResolvedValue({
        id: "rest_123",
        slug: "test-restaurant",
      });

      const req1 = createRequest("POST", "http://localhost/api/extension/queue/claim", {
        campaignId: "camp_test",
      });
      req1.headers.set("Authorization", "Bearer valid-token");
      const res1 = await claimPost(req1 as any);
      const json1 = await res1.json();
      expect(json1).toEqual({ status: "success", data: { claimed: true } });

      const req2 = createRequest("POST", "http://localhost/api/extension/queue/claim", {
        campaignId: "camp_test",
      });
      req2.headers.set("Authorization", "Bearer valid-token");
      const res2 = await claimPost(req2 as any);
      const json2 = await res2.json();
      expect(json2).toEqual({ status: "success", data: { claimed: false } });
    });

    it("10.10: missing token returns 401, missing campaignId returns 400", async () => {
      // Missing token
      const reqNoAuth = createRequest("POST", "http://localhost/api/extension/queue/claim", {
        campaignId: "camp_test",
      });
      const resNoAuth = await claimPost(reqNoAuth as any);
      expect(resNoAuth.status).toBe(401);
      const jsonNoAuth = await resNoAuth.json();
      expect(jsonNoAuth.status).toBe("error");

      // Missing campaignId
      mockDB.query.restaurantsTable.findFirst = vi.fn().mockResolvedValue({
        id: "rest_123",
        slug: "test-restaurant",
      });
      const reqNoCampaign = createRequest("POST", "http://localhost/api/extension/queue/claim", {});
      reqNoCampaign.headers.set("Authorization", "Bearer valid-token");
      const resNoCampaign = await claimPost(reqNoCampaign as any);
      expect(resNoCampaign.status).toBe(400);
      const jsonNoCampaign = await resNoCampaign.json();
      expect(jsonNoCampaign.status).toBe("fail");
    });
  });

  // ─── 10.11: POST /api/extension/queue/scheduled — transitions atomically ──
  describe("POST /api/extension/queue/scheduled", () => {
    it("10.11: transitions to scheduled atomically", async () => {
      (campaignRepo.markAsScheduled as any) = vi.fn().mockResolvedValue({ scheduled: true });

      mockDB.query.restaurantsTable.findFirst = vi.fn().mockResolvedValue({
        id: "rest_123",
        slug: "test-restaurant",
      });

      const req = createRequest("POST", "http://localhost/api/extension/queue/scheduled", {
        campaignId: "camp_test",
        scheduledAt: "2026-06-21T14:00:00.000Z",
      });
      req.headers.set("Authorization", "Bearer valid-token");
      const res = await scheduledPost(req as any);
      const json = await res.json();

      expect(json).toEqual({ status: "success", data: { scheduled: true } });
    });

    it("rejects invalid scheduledAt with 400", async () => {
      mockDB.query.restaurantsTable.findFirst = vi.fn().mockResolvedValue({
        id: "rest_123",
        slug: "test-restaurant",
      });

      const req = createRequest("POST", "http://localhost/api/extension/queue/scheduled", {
        campaignId: "camp_test",
        scheduledAt: "not-a-date",
      });
      req.headers.set("Authorization", "Bearer valid-token");
      const res = await scheduledPost(req as any);
      expect(res.status).toBe(400);
    });
  });
});
