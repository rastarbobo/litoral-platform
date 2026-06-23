import { describe, it, expect, vi, beforeEach } from "vitest";
import { useDashboardStore } from "@/store/dashboard-store";

beforeEach(() => {
  vi.restoreAllMocks();
  useDashboardStore.setState({
    activeTab: "queue",
    restaurantId: null,
    token: null,
    campaigns: { pending: [], scheduled: [], published: [] },
    results: null,
    isLoading: false,
    error: null,
    actionInFlight: {},
    lastFetchedAt: null,
    filters: { sort: "created_at_desc", campaignType: "all", source: "all" },
  });
});

describe("dashboard-store tab state", () => {
  it("defaults to queue tab", () => {
    expect(useDashboardStore.getState().activeTab).toBe("queue");
  });

  it("persists tab across switches", () => {
    const store = useDashboardStore.getState();
    store.setActiveTab("results");
    expect(useDashboardStore.getState().activeTab).toBe("results");
    store.setActiveTab("settings");
    expect(useDashboardStore.getState().activeTab).toBe("settings");
    store.setActiveTab("queue");
    expect(useDashboardStore.getState().activeTab).toBe("queue");
  });
});

describe("dashboard-store filter state", () => {
  it("has default filter values", () => {
    const { filters } = useDashboardStore.getState();
    expect(filters.sort).toBe("created_at_desc");
    expect(filters.campaignType).toBe("all");
    expect(filters.source).toBe("all");
  });

  it("updates filters independently", () => {
    useDashboardStore.getState().setFilters({ sort: "created_at_asc", campaignType: "all", source: "all" });
    expect(useDashboardStore.getState().filters.sort).toBe("created_at_asc");

    useDashboardStore.getState().setFilters({ sort: "created_at_desc", campaignType: "flash_offer", source: "all" });
    expect(useDashboardStore.getState().filters.campaignType).toBe("flash_offer");
  });

  it("persists filter state across tab switches", () => {
    useDashboardStore.getState().setFilters({ sort: "created_at_asc", campaignType: "seasonal_event", source: "owner_initiated" });
    useDashboardStore.getState().setActiveTab("results");
    useDashboardStore.getState().setActiveTab("queue");

    const { filters } = useDashboardStore.getState();
    expect(filters.sort).toBe("created_at_asc");
    expect(filters.campaignType).toBe("seasonal_event");
  });
});

describe("dashboard-store actionInFlight guard", () => {
  it("tracks action in flight for a campaign", () => {
    useDashboardStore.setState({ actionInFlight: { camp_abc: "approve" } });
    expect(useDashboardStore.getState().actionInFlight.camp_abc).toBe("approve");
  });

  it("clearActionInFlight removes tracking", () => {
    useDashboardStore.setState({ actionInFlight: { camp_abc: "approve", camp_xyz: "reject" } });
    useDashboardStore.getState().clearActionInFlight("camp_abc");
    const state = useDashboardStore.getState().actionInFlight;
    expect(state.camp_abc).toBeUndefined();
    expect(state.camp_xyz).toBe("reject");
  });

  it("performAction throws when action already in flight", async () => {
    useDashboardStore.setState({
      restaurantId: "rest_1",
      actionInFlight: { camp_abc: "approve" },
    });

    await expect(
      useDashboardStore.getState().performAction("camp_abc", "approve", "rest_1"),
    ).rejects.toThrow("Action already in progress");
  });
});

describe("dashboard-store optimistic update", () => {
  const makeCampaign = (id: string) => ({
    id,
    status: "pending_approval",
    restaurantId: "rest_1",
    createdAt: new Date(),
    thumbnailUrl: null,
  });

  it("moves campaign from pending to scheduled on approve", async () => {
    const camp = makeCampaign("camp_001");
    useDashboardStore.setState({
      restaurantId: "rest_1",
      campaigns: { pending: [camp as never] as never[], scheduled: [] as never[], published: [] },
    });

    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ status: "success" }) }),
    ) as unknown as typeof fetch;

    await useDashboardStore.getState().performAction("camp_001", "approve", "rest_1");

    const { campaigns } = useDashboardStore.getState();
    expect(campaigns.pending).toHaveLength(0);
    expect(campaigns.scheduled).toHaveLength(1);
  });

  it("removes rejected campaign from pending", async () => {
    const camp = makeCampaign("camp_001");
    useDashboardStore.setState({
      restaurantId: "rest_1",
      campaigns: { pending: [camp as never] as never[], scheduled: [] as never[], published: [] },
    });

    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ status: "success" }) }),
    ) as unknown as typeof fetch;

    await useDashboardStore.getState().performAction("camp_001", "reject", "rest_1");

    expect(useDashboardStore.getState().campaigns.pending).toHaveLength(0);
  });

  it("rolls back on API failure", async () => {
    const camp = makeCampaign("camp_001");
    useDashboardStore.setState({
      restaurantId: "rest_1",
      campaigns: { pending: [camp as never] as never[], scheduled: [] as never[], published: [] },
    });

    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ status: "error", message: "DB error" }) }),
    ) as unknown as typeof fetch;

    await expect(
      useDashboardStore.getState().performAction("camp_001", "approve", "rest_1"),
    ).rejects.toThrow("DB error");

    const { campaigns, actionInFlight } = useDashboardStore.getState();
    expect(campaigns.pending).toHaveLength(1);
    expect(actionInFlight.camp_001).toBeUndefined();
  });
});

describe("dashboard-store stale-while-revalidate", () => {
  const mockFetch = (data: unknown) => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve(data) }),
    ) as unknown as typeof fetch;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    useDashboardStore.setState({ actionInFlight: {} });
  });

  it("does not refetch if data is fresh (< 2 min)", async () => {
    useDashboardStore.setState({
      restaurantId: "rest_1",
      lastFetchedAt: Date.now() - 60_000,
    });

    let fetchCalled = false;
    global.fetch = vi.fn(() => {
      fetchCalled = true;
      return Promise.resolve({
        json: () => Promise.resolve({ status: "success", data: { pending: [], scheduled: [], published: [] } }),
      });
    }) as unknown as typeof fetch;

    await useDashboardStore.getState().refreshIfStale("rest_1");
    expect(fetchCalled).toBe(false);
  });

  it("refetches if data is stale (> 2 min)", async () => {
    useDashboardStore.setState({
      restaurantId: "rest_1",
      lastFetchedAt: Date.now() - 3 * 60_000,
    });

    let fetchCalled = false;
    global.fetch = vi.fn(() => {
      fetchCalled = true;
      return Promise.resolve({
        json: () => Promise.resolve({ status: "success", data: { pending: [], scheduled: [], published: [] } }),
      });
    }) as unknown as typeof fetch;

    await useDashboardStore.getState().refreshIfStale("rest_1");
    expect(fetchCalled).toBe(true);
  });

  it("refetches if never fetched", async () => {
    useDashboardStore.setState({ restaurantId: "rest_1", lastFetchedAt: null });

    let fetchCalled = false;
    global.fetch = vi.fn(() => {
      fetchCalled = true;
      return Promise.resolve({
        json: () => Promise.resolve({ status: "success", data: { pending: [], scheduled: [], published: [] } }),
      });
    }) as unknown as typeof fetch;

    await useDashboardStore.getState().refreshIfStale("rest_1");
    expect(fetchCalled).toBe(true);
  });
});