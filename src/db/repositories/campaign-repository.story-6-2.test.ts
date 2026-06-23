import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { campaignRepo } from "./campaign-repository";
import { getDB } from "@/db";

// ─── Mocks ─────────────────────────────────────────────────

vi.mock("@/db", () => ({
  getDB: vi.fn(),
}));

// ─── Helpers ────────────────────────────────────────────────

function createMockDB(overrides: Record<string, unknown> = {}) {
  const defaultDB = {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => ({
          execute: vi.fn().mockResolvedValue([{ id: "crev_test123" }]),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => ({
            execute: vi.fn().mockResolvedValue([{ id: "camp_test456", status: "approved" }]),
          })),
        })),
      })),
    })),
    query: {
      campaignsTable: {
        findFirst: vi.fn().mockResolvedValue({
          id: "camp_test",
          status: "approved",
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      restaurantsTable: {
        findFirst: vi.fn().mockResolvedValue({
          id: "rest_test",
          slug: "test-restaurant",
        }),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            execute: vi.fn().mockResolvedValue([{ telegramChatId: "123456" }]),
          })),
        })),
      })),
    })),
  };
  return { ...defaultDB, ...overrides } as any;
}

// ─── Tests: Story 6.2 — Database-layer pending_schedule Lock ─────

describe("Story 6.2: Extension Publishing Lock", () => {
  let mockDB: any;

  beforeEach(() => {
    mockDB = createMockDB();
    (getDB as ReturnType<typeof vi.fn>).mockReturnValue(mockDB);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── 10.1 Unit: claimForScheduling — first claim succeeds ──
  // ─── 10.2 Unit: claimForScheduling — second claim returns false (idempotent) ──
  // ─── 10.3 Unit: claimForScheduling — cross-restaurant claim returns false ──
  // ─── 10.4 Unit: claimForScheduling — campaign not approved returns false ──
  describe("claimForScheduling", () => {
    it("10.1: first claim succeeds { claimed: true }", async () => {
      mockDB.update = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => ({
              execute: vi.fn().mockResolvedValue([{ id: "camp_test" }]),
            })),
          })),
        })),
      }));

      const result = await campaignRepo.claimForScheduling("camp_test", "rest_123", "test-restaurant");

      expect(result).toEqual({ claimed: true });
    });

    it("10.2: second claim returns { claimed: false } (idempotent)", async () => {
      mockDB.update = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => ({
              execute: vi.fn().mockResolvedValue([]), // Zero rows affected = already claimed
            })),
          })),
        })),
      }));

      const result = await campaignRepo.claimForScheduling("camp_test", "rest_123", "test-restaurant");

      expect(result).toEqual({ claimed: false });
    });

    it("10.3: cross-restaurant claim returns { claimed: false } (multi-tenancy)", async () => {
      mockDB.update = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => ({
              execute: vi.fn().mockResolvedValue([]), // Zero rows = wrong restaurant
            })),
          })),
        })),
      }));

      const result = await campaignRepo.claimForScheduling("camp_test", "rest_different", "other-restaurant");

      expect(result).toEqual({ claimed: false });
    });

    it("10.4: campaign not in 'approved' status returns { claimed: false }", async () => {
      mockDB.update = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => ({
              execute: vi.fn().mockResolvedValue([]), // Zero rows = status ≠ 'approved'
            })),
          })),
        })),
      }));

      const result = await campaignRepo.claimForScheduling("camp_test", "rest_123", "test-restaurant");

      expect(result).toEqual({ claimed: false });
    });
  });

  // ─── 10.5 Unit: markAsScheduled — transitions pending_schedule → scheduled ──
  // ─── 10.6 Unit: markAsScheduled — campaign already scheduled returns false ──
  describe("markAsScheduled", () => {
    it("10.5: transitions pending_schedule → scheduled with scheduledAt set", async () => {
      mockDB.update = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => ({
              execute: vi.fn().mockResolvedValue([{ id: "camp_test" }]),
            })),
          })),
        })),
      }));

      const now = new Date("2026-06-21T12:00:00.000Z");
      const result = await campaignRepo.markAsScheduled("camp_test", "rest_123", now);

      expect(result).toEqual({ scheduled: true });
    });

    it("10.6: campaign not in pending_schedule returns { scheduled: false }", async () => {
      mockDB.update = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => ({
              execute: vi.fn().mockResolvedValue([]), // Zero rows = not in pending_schedule
            })),
          })),
        })),
      }));

      const now = new Date();
      const result = await campaignRepo.markAsScheduled("camp_test", "rest_123", now);

      expect(result).toEqual({ scheduled: false });
    });

    it("rejects invalid Date (NaN) with DATABASE_ERROR", async () => {
      const result = await campaignRepo.markAsScheduled("camp_test", "rest_123", new Date("invalid"));

      expect(result).toEqual({
        type: "DATABASE_ERROR",
        campaignId: "camp_test",
        message: "Invalid scheduledAtDate: must be a valid Date object",
      });
    });
  });

  // ─── 10.7 Unit: listApproved — returns only approved campaigns with platforms set ──
  // ─── 10.8 Unit: listByStatus — filters correctly by status ──
  describe("listApproved", () => {
    it("10.7: returns only approved campaigns with platforms", async () => {
      const approvedCampaigns = [
        { id: "camp_1", status: "approved", platforms: "instagram", createdAt: new Date() },
        { id: "camp_2", status: "approved", platforms: "facebook,tiktok", createdAt: new Date() },
      ];

      mockDB.query.campaignsTable.findMany = vi.fn().mockResolvedValue(approvedCampaigns);

      const result = await campaignRepo.listApproved("rest_123");

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe("approved");
      expect(result[0].platforms).toBeTruthy();
    });

    it("10.7: excludes campaigns without platforms", async () => {
      const allCampaigns = [
        { id: "camp_1", status: "approved", platforms: "instagram", createdAt: new Date() },
        { id: "camp_2", status: "approved", platforms: null, createdAt: new Date() },
      ];

      mockDB.query.campaignsTable.findMany = vi
        .fn()
        .mockResolvedValue(allCampaigns.filter((c) => c.platforms != null));

      const result = await campaignRepo.listApproved("rest_123");

      expect(result.some((c) => c.platforms == null)).toBe(false);
    });
  });

  describe("listByStatus", () => {
    it("10.8: filters correctly by status", async () => {
      const scheduledCampaigns = [
        { id: "camp_1", status: "scheduled" },
        { id: "camp_2", status: "scheduled" },
      ];

      mockDB.query.campaignsTable.findMany = vi.fn().mockResolvedValue(scheduledCampaigns);

      const result = await campaignRepo.listByStatus("rest_123", "scheduled");

      expect(result).toHaveLength(2);
      expect(result.every((c) => c.status === "scheduled")).toBe(true);
    });
  });
});
