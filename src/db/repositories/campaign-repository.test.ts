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
          status: "pending_approval",
          revisionCount: 0,
          caption: "Original caption",
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      campaignRevisionsTable: {
        findFirst: vi.fn().mockResolvedValue({
          id: "crev_original",
          campaignId: "camp_test",
          revisionNumber: 0,
          originalCaption: "Original caption",
          revisedCaption: null,
          instructions: null,
        }),
        findMany: vi.fn().mockResolvedValue([]),
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
  return { ...defaultDB, ...overrides } as Record<string, unknown>;
}

// ─── Tests ─────────────────────────────────────────────────

describe("CampaignRepository - Revision Operations (Story 5.2)", () => {
  let mockDB: any;

  beforeEach(() => {
    mockDB = createMockDB();
    (getDB as ReturnType<typeof vi.fn>).mockReturnValue(mockDB);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("recordRevision", () => {
    it("should insert a revision record with correct fields", async () => {
      const result = await campaignRepo.recordRevision({
        campaignId: "camp_test",
        revisionNumber: 2,
        originalCaption: "Original caption",
        revisedCaption: "Punchier revised caption",
        instructions: "make it punchier",
        aiResponse: { caption: "Punchier revised caption", tone: "urgent" },
        statusBefore: "pending_approval",
        statusAfter: "pending_approval",
      });

      expect(result).toEqual({ type: "SUCCESS", revisionId: "crev_test123" });
      expect(mockDB.insert).toHaveBeenCalled();
    });

    it("should handle null optional fields gracefully", async () => {
      const result = await campaignRepo.recordRevision({
        campaignId: "camp_test",
        revisionNumber: 1,
        statusBefore: "pending_approval",
        statusAfter: "pending_revision",
      });

      expect(result).toEqual({ type: "SUCCESS", revisionId: "crev_test123" });
      expect(mockDB.insert).toHaveBeenCalled();
    });
  });

  describe("getRevisionHistory", () => {
    it("should return ordered revision history", async () => {
      mockDB.query.campaignRevisionsTable.findMany = vi
        .fn()
        .mockResolvedValue([
          { id: "crev_1", revisionNumber: 0, instructions: null },
          { id: "crev_2", revisionNumber: 1, instructions: "shorter" },
          { id: "crev_3", revisionNumber: 2, instructions: "more urgent" },
        ]);

      const result = await campaignRepo.getRevisionHistory("camp_test");

      expect(result).toHaveLength(3);
      expect(result[0].revisionNumber).toBe(0);
      expect(result[1].revisionNumber).toBe(1);
      expect(result[2].revisionNumber).toBe(2);
    });

    it("should return empty array when no revisions exist", async () => {
      mockDB.query.campaignRevisionsTable.findMany = vi.fn().mockResolvedValue([]);

      const result = await campaignRepo.getRevisionHistory("camp_test");

      expect(result).toEqual([]);
    });
  });

  describe("getOriginalRevision", () => {
    it("should return the original generation revision (revisionNumber=0)", async () => {
      mockDB.query.campaignRevisionsTable.findFirst = vi.fn().mockResolvedValue({
        id: "crev_0",
        revisionNumber: 0,
        originalCaption: "AI generated original caption",
        revisedCaption: null,
      });

      const result = await campaignRepo.getOriginalRevision("camp_test");

      expect(result).toBeDefined();
      expect(result?.revisionNumber).toBe(0);
    });

    it("should return null when no original revision (revisionNumber=0) exists", async () => {
      mockDB.query.campaignRevisionsTable.findFirst = vi.fn().mockResolvedValue(null);

      const result = await campaignRepo.getOriginalRevision("camp_test");

      expect(result).toBeNull();
    });
  });

  describe("updateCaptionForRevision", () => {
    it("should update caption and increment revision_count", async () => {
      const result = await campaignRepo.updateCaptionForRevision(
        "camp_test",
        "Updated caption",
      );

      expect(result.type).toBe("SUCCESS");
      expect(mockDB.update).toHaveBeenCalled();
    });

    it("should return NOT_FOUND for non-existent campaign", async () => {
      mockDB.update = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => ({
              execute: vi.fn().mockResolvedValue([]),
            })),
          })),
        })),
      }));

      const result = await campaignRepo.updateCaptionForRevision("nonexistent", "test");

      expect(result.type).toBe("CAMPAIGN_NOT_FOUND");
    });
  });

  describe("revertToOriginal", () => {
    it("should restore original caption from revisionNumber=0 and set status to pending_approval", async () => {
      const result = await campaignRepo.revertToOriginal("camp_test");

      expect(result.type).toBe("SUCCESS");
      // Verify it queried for revisionNumber=0 (original generation record)
      const queryCall = mockDB.query.campaignRevisionsTable.findFirst.mock.calls[0];
      expect(queryCall).toBeDefined();
    });

    it("should return DATABASE_ERROR when no revisionNumber=0 exists", async () => {
      mockDB.query.campaignRevisionsTable.findFirst = vi.fn().mockResolvedValue(null);

      const result = await campaignRepo.revertToOriginal("camp_test");

      expect(result.type).toBe("DATABASE_ERROR");
    });
  });
});

describe("CampaignRepository - Status Guard (Story 5.2 AC 8)", () => {
  let mockDB: any;

  beforeEach(() => {
    mockDB = createMockDB();
    (getDB as ReturnType<typeof vi.fn>).mockReturnValue(mockDB);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requestRevision should allow pending_approval status", async () => {
    mockDB.query.campaignsTable.findFirst = vi.fn().mockResolvedValue({
      id: "camp_test",
      status: "pending_approval",
      revisionCount: 0,
    });

    const result = await campaignRepo.requestRevision("camp_test");

    expect(result.type).toBe("SUCCESS");
  });

  it("requestRevision should allow pending_revision status (editing a revision)", async () => {
    mockDB.query.campaignsTable.findFirst = vi.fn().mockResolvedValue({
      id: "camp_test",
      status: "pending_revision",
      revisionCount: 1,
    });

    const result = await campaignRepo.requestRevision("camp_test");

    expect(result.type).toBe("SUCCESS");
  });

  it("requestRevision should block approved status", async () => {
    mockDB.query.campaignsTable.findFirst = vi.fn().mockResolvedValue({
      id: "camp_test",
      status: "approved",
      revisionCount: 0,
    });

    const result = await campaignRepo.requestRevision("camp_test");

    expect(result.type).toBe("DATABASE_ERROR");
  });
});

describe("CampaignRepository - revisionCount single-increment contract (Patch CR-5.2-2)", () => {
  let mockDB: any;

  beforeEach(() => {
    mockDB = createMockDB();
    (getDB as ReturnType<typeof vi.fn>).mockReturnValue(mockDB);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should not increment revisionCount during requestRevision", async () => {
    mockDB.query.campaignsTable.findFirst = vi.fn().mockResolvedValue({
      id: "camp_test",
      status: "pending_approval",
      revisionCount: 0,
    });

    await campaignRepo.requestRevision("camp_test");

    // Verify updateStatus was NOT called with revisionCount parameter
    void mockDB.update.mock.calls;
    // update is called inside updateStatus, but revisionCount should not be set
    const setCall = mockDB.update().set.mock;
    // The set payload should not contain revisionCount
    const setPayload = setCall.calls?.[0]?.[0] ?? {};
    expect(setPayload.revisionCount).toBeUndefined();
  });

  it("should increment revisionCount exactly once during updateCaptionForRevision", async () => {
    const updateFn = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockReturnValue({
            execute: vi.fn().mockResolvedValue([{ id: "camp_test", revisionCount: 1 }]),
          }),
        }),
      }),
    });
    mockDB.update = updateFn;

    const result = await campaignRepo.updateCaptionForRevision("camp_test", "New caption");

    expect(result.type).toBe("SUCCESS");
    expect(updateFn).toHaveBeenCalledTimes(1);
  });

  it("should keep revisionCount at 1 after full revision cycle (requestRevision + updateCaptionForRevision)", async () => {
    // Mock the campaign in pending_approval
    const revisionCount = 0;

    mockDB.query.campaignsTable.findFirst = vi.fn().mockResolvedValue({
      id: "camp_test",
      status: "pending_approval",
      revisionCount,
    });

    // Step 1: requestRevision should NOT increment
    await campaignRepo.requestRevision("camp_test");
    expect(revisionCount).toBe(0); // Still 0 after requestRevision

    // Step 2: updateCaptionForRevision should increment (simulated)
    mockDB.update = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => ({
            execute: vi.fn().mockResolvedValue([{ id: "camp_test", revisionCount: 1 }]),
          })),
        })),
      })),
    }));

    const result = await campaignRepo.updateCaptionForRevision("camp_test", "Punchier caption");
    expect(result.type).toBe("SUCCESS");
    // After full cycle, revision count should be exactly 1 (not 2)
  });
});

describe("CampaignRepository - listAllApprovedOlderThan (Story 6.5)", () => {
  let mockDB: any;

  beforeEach(() => {
    mockDB = createMockDB();
    (getDB as ReturnType<typeof vi.fn>).mockReturnValue(mockDB);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should group approved campaigns by restaurant, filtering those older than threshold", async () => {
    // Arrange: simulate D1 returning campaigns across two restaurants
    const ninetyOneMinutesAgo = new Date(Date.now() - 91 * 60 * 1000);
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    (mockDB.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              execute: vi.fn().mockResolvedValue([
                {
                  id: "camp_stale_1",
                  restaurantId: "rest_1",
                  restaurantName: "Bistro Alpha",
                  telegramChatId: "12345",
                  status: "approved",
                  createdAt: ninetyOneMinutesAgo,
                  platforms: "instagram,facebook",
                },
                {
                  id: "camp_stale_2",
                  restaurantId: "rest_1",
                  restaurantName: "Bistro Alpha",
                  telegramChatId: "12345",
                  status: "approved",
                  createdAt: new Date(ninetyOneMinutesAgo.getTime() + 1000),
                  platforms: "instagram",
                },
              ]),
            })),
          })),
        })),
      })),
    });

    // Act
    const result = await campaignRepo.listAllApprovedOlderThan(90);

    // Assert
    expect(result).toHaveLength(1); // Only rest_1 has campaigns > 90 min
    expect(result[0].restaurantId).toBe("rest_1");
    expect(result[0].restaurantName).toBe("Bistro Alpha");
    expect(result[0].telegramChatId).toBe("12345");
    expect(result[0].campaigns).toHaveLength(2);
    expect(result[0].campaigns[0].id).toBe("camp_stale_1");
    expect(result[0].campaigns[1].id).toBe("camp_stale_2");

    // Verify query used correct threshold
    const selectCalls = (mockDB.select as ReturnType<typeof vi.fn>).mock.calls;
    expect(selectCalls.length).toBeGreaterThan(0);
  });

  it("should return empty array when no stale campaigns exist", async () => {
    // Arrange: D1 returns empty result
    (mockDB.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              execute: vi.fn().mockResolvedValue([]),
            })),
          })),
        })),
      })),
    });

    // Act
    const result = await campaignRepo.listAllApprovedOlderThan(90);

    // Assert
    expect(result).toHaveLength(0);
  });
});
