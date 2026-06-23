"use client";

import { create } from "zustand";
import type {
  DashboardTab,
  CampaignGroup,
  ResultsData,
  CampaignAction,
  FilterState,
} from "@/lib/dashboard/types";

/**
 * Zustand store for the mobile dashboard surface.
 *
 * Architecture note (Story 5.3):
 * - The store is initialised with SSR data passed as props from the Server Component.
 * - Client-side hydration is for interactivity (tab switching, pull-to-refresh) only.
 * - Never fetch initial data in a client effect (violates AC-9 SSR mandate).
 *
 * Story 5.4 additions:
 * - actionInFlight: prevents double-submit on campaign actions
 * - lastFetchedAt: stale-while-revalidate timestamp
 * - filters: persisted filter state across tab switches
 * - performAction, setFilters, clearActionInFlight, refreshIfStale, setLastFetchedAt
 */

const STALE_MS = 2 * 60 * 1000; // 2 minutes

interface DashboardStore {
  // ── State ──
  activeTab: DashboardTab;
  restaurantId: string | null;
  token: string | null;
  campaigns: CampaignGroup;
  results: ResultsData | null;
  isLoading: boolean;
  error: string | null;

  // Story 5.4: Queue action & filter state
  actionInFlight: Record<string, string>;
  lastFetchedAt: number | null;
  filters: FilterState;

  // Story 5.5: Settings / Persona state
  personaUpdatedAt: number | null;
  lastKnownTier: string | null;
  personaFormDirty: boolean;

  // ── Actions ──
  setActiveTab: (tab: DashboardTab) => void;
  setRestaurantId: (id: string) => void;
  setToken: (token: string) => void;
  setCampaigns: (campaigns: CampaignGroup) => void;
  setResults: (results: ResultsData) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;

  // Story 5.4 actions
  performAction: (
    campaignId: string,
    action: CampaignAction,
    restaurantId: string,
    extra?: Record<string, string>,
  ) => Promise<void>;
  setFilters: (filters: FilterState) => void;
  clearActionInFlight: (campaignId: string) => void;
  refreshIfStale: (restaurantId: string) => Promise<void>;
  setLastFetchedAt: (ts: number | null) => void;

  // Story 5.5 actions
  setPersonaUpdatedAt: (timestamp: number) => void;
  setLastKnownTier: (tier: string) => void;
  setPersonaFormDirty: (dirty: boolean) => void;
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  activeTab: "queue",
  restaurantId: null,
  token: null,
  campaigns: { pending: [], scheduled: [], published: [], rejected: [] },
  results: null,
  isLoading: false,
  error: null,

  actionInFlight: {},
  lastFetchedAt: null,
  filters: {
    sort: "created_at_desc",
    campaignType: "all",
    source: "all",
  },

  personaUpdatedAt: null,
  lastKnownTier: null,
  personaFormDirty: false,

  // ── Setters ─────────────────────────────────────────────
  setActiveTab: (tab) => set({ activeTab: tab }),
  setRestaurantId: (id) => set({ restaurantId: id }),
  setToken: (token) => set({ token }),
  setCampaigns: (campaigns) => set({ campaigns }),
  setResults: (results) => set({ results }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setFilters: (filters) => set({ filters }),
  setLastFetchedAt: (ts) => set({ lastFetchedAt: ts }),
  setPersonaUpdatedAt: (timestamp) => set({ personaUpdatedAt: timestamp }),
  setLastKnownTier: (tier) => set({ lastKnownTier: tier }),
  setPersonaFormDirty: (dirty) => set({ personaFormDirty: dirty }),
  clearActionInFlight: (campaignId) => {
    set((state) => {
      const next = { ...state.actionInFlight };
      delete next[campaignId];
      return { actionInFlight: next };
    });
  },

  // ── Campaign Action (with optimistic update) ─────────────
  performAction: async (campaignId, action, restaurantId, extra) => {
    const store = get();

    // Guard: already in flight for this campaign
    if (store.actionInFlight[campaignId]) {
      throw new Error("Action already in progress for this campaign");
    }

    // Mark in-flight
    set((state) => ({
      actionInFlight: { ...state.actionInFlight, [campaignId]: action },
    }));

    // ── Optimistic update ──
    const currentCampaigns = get().campaigns;
    const snapshot = { ...currentCampaigns };

    try {
      // Move campaign optimistically — always read latest state via get()
      const moveTo = (from: keyof CampaignGroup, to: keyof CampaignGroup) => {
        const live = get().campaigns;
        const campaign = live[from]?.find((c) => c.id === campaignId);
        if (campaign) {
          const updatedFrom = live[from].filter((c) => c.id !== campaignId);
          const updatedTo = [campaign, ...live[to]];
          set({
            campaigns: {
              ...live,
              [from]: updatedFrom,
              [to]: updatedTo,
            },
          });
        }
      };

      if (action === "approve") {
        moveTo("pending", "scheduled");
      } else if (action === "reject") {
        // Remove from pending (rejected goes out of regular queue view)
        const live = get().campaigns;
        set({
          campaigns: {
            ...live,
            pending: live.pending.filter((c) => c.id !== campaignId),
          },
        });
      } else if (action === "request_revision") {
        // Stay in pending section but update status to pending_revision
        const live = get().campaigns;
        set({
          campaigns: {
            ...live,
            pending: live.pending.map((c) =>
              c.id === campaignId ? { ...c, status: "pending_revision" as const } : c,
            ),
          },
        });
      }

      // Call API
      const body: Record<string, string> = { campaignId, action };
      if (extra?.revisionInstructions) {
        body.revisionInstructions = extra.revisionInstructions;
      }
      if (extra?.rejectReason) {
        body.rejectReason = extra.rejectReason;
      }

      const res = await fetch("/api/dashboard/campaigns/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = (await res.json()) as { status: string; message?: string };

      if (json.status !== "success") {
        // Rollback optimistic update
        set({ campaigns: snapshot });
        throw new Error(json.message ?? `Failed to ${action} campaign`);
      }

      // Success — keep optimistic state, clear in-flight, update lastFetchedAt
      set((state) => {
        const next = { ...state.actionInFlight };
        delete next[campaignId];
        return { actionInFlight: next, lastFetchedAt: Date.now() };
      });
    } catch (err) {
      // Rollback optimistic update
      set({ campaigns: snapshot });
      set((state) => {
        const next = { ...state.actionInFlight };
        delete next[campaignId];
        return { actionInFlight: next };
      });
      throw err;
    }
  },

  // ── Stale-while-revalidate ───────────────────────────────
  refreshIfStale: async (restaurantId) => {
    const store = get();
    const now = Date.now();

    if (store.lastFetchedAt && (now - store.lastFetchedAt) < STALE_MS) {
      // Still fresh — don't refetch
      return;
    }

    // Background refresh
    try {
      const { sort, campaignType, source } = store.filters;
      const params = new URLSearchParams({ restaurantId });
      params.set("sort", sort);
      if (campaignType !== "all") params.set("campaignType", campaignType);
      if (source !== "all") params.set("source", source);

      const res = await fetch(`/api/dashboard/campaigns?${params.toString()}`);
      const json = (await res.json()) as {
        status: string;
        data?: { pending: never[]; scheduled: never[]; published: never[] };
      };
      if (json.status === "success" && json.data) {
        set({
          campaigns: json.data as {
            pending: never[];
            scheduled: never[];
            published: never[];
          },
          lastFetchedAt: now,
        });
      }
    } catch (err) {
      console.error("Background refresh failed:", err);
    }
  },
}));