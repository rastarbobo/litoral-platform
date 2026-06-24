"use client";

import React from "react";
import { useDashboardStore } from "@/store/dashboard-store";
import { MobileAppShell } from "@/components/dashboard/mobile-app-shell";
import { CampaignQueueList } from "@/components/dashboard/queue/list";
import { ResultsView } from "@/components/dashboard/results/view";
import { SettingsView } from "@/components/dashboard/settings/view";
import { HibernateView } from "@/components/dashboard/hibernate/view";
import type { ReactivationEligibilityData } from "@/components/dashboard/hibernate/view";
import { resolveSession } from "@/lib/dashboard/auth-guard";
import { RequestAccessCard } from "@/components/dashboard/request-access-card";
import { CampaignGroup, ResultsData } from "@/lib/dashboard/types";

interface DashboardClientProps {
  initialRestaurantId?: string;
}

/**
 * DashboardClient — Client Component for interactivity.
 *
 * When `initialRestaurantId` is provided (from SSR), skips auth and renders immediately.
 * When not provided, resolves session from hash fragment or localStorage.
 */
export function DashboardClient({ initialRestaurantId }: DashboardClientProps) {
  const activeTab = useDashboardStore((s) => s.activeTab);
  const restaurantId = useDashboardStore((s) => s.restaurantId);
  const results = useDashboardStore((s) => s.results);
  const setRestaurantId = useDashboardStore((s) => s.setRestaurantId);
  const setCampaigns = useDashboardStore((s) => s.setCampaigns);
  const setResults = useDashboardStore((s) => s.setResults);
  const [authState, setAuthState] = React.useState<
    "loading" | "authenticated" | "unauthenticated"
  >(initialRestaurantId ? "authenticated" : "loading");

  // Hibernate state (Story 7.5)
  const [isHibernate, setIsHibernate] = React.useState(false);
  const [hibernateEligibility, setHibernateEligibility] =
    React.useState<ReactivationEligibilityData | null>(null);
  const [isReactivating, setIsReactivating] = React.useState(false);

  // Initialize from SSR data if available
  React.useEffect(() => {
    if (initialRestaurantId) {
      setRestaurantId(initialRestaurantId);
      fetchDashboardData(initialRestaurantId, setCampaigns, setResults, setIsHibernate, setHibernateEligibility);
      return;
    }

    // Client-side auth resolution
    resolveSession().then((result) => {
      if (result.isValid && result.session) {
        setRestaurantId(result.session.restaurantId);
        setAuthState("authenticated");
        fetchDashboardData(result.session.restaurantId, setCampaigns, setResults, setIsHibernate, setHibernateEligibility);
      } else {
        setAuthState("unauthenticated");
      }
    });
  }, [initialRestaurantId, setRestaurantId, setCampaigns, setResults]);

  const handleReactivate = React.useCallback(async () => {
    if (!restaurantId) return;
    setIsReactivating(true);
    try {
      const res = await fetch("/api/subscription/reactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId }),
      });
      const json = (await res.json()) as {
        status: string;
        data?: { newMode: string; subscriptionStatus: string };
        message?: string;
      };
      if (json.status === "success") {
        setIsHibernate(false);
        // Re-fetch dashboard data after reactivation
        fetchDashboardData(restaurantId, setCampaigns, setResults, setIsHibernate, setHibernateEligibility);
      } else {
        console.error("Reactivation failed:", json.message);
      }
    } catch (err) {
      console.error("Reactivation error:", err);
    } finally {
      setIsReactivating(false);
    }
  }, [restaurantId, setCampaigns, setResults]);

  if (authState === "loading" && !initialRestaurantId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F5F7]">
        <div className="text-[16px] text-[#717786]" style={{ fontFamily: "Inter, sans-serif" }}>
          Loading your dashboard…
        </div>
      </div>
    );
  }

  if (authState === "unauthenticated") {
    return <RequestAccessCard />;
  }

  // Story 7.5: Render Hibernate view when subscription is paused
  if (isHibernate && restaurantId) {
    return (
      <MobileAppShell title="Subscription Paused">
        <HibernateView
          restaurantName="Your restaurant"
          eligibility={hibernateEligibility}
          onReactivate={handleReactivate}
          isReactivating={isReactivating}
        />
      </MobileAppShell>
    );
  }

  const currentTitle = tabTitle(activeTab);
  const displayRestaurantId = initialRestaurantId || restaurantId;

  return (
    <MobileAppShell title={currentTitle}>
      <div className="pt-4 pb-4">
        {activeTab === "queue" && displayRestaurantId && (
          <CampaignQueueList restaurantId={displayRestaurantId} />
        )}
        {activeTab === "results" && <ResultsView data={results} />}
        {activeTab === "settings" && <SettingsView />}
      </div>
    </MobileAppShell>
  );
}

// ─── Helpers ─────────────────────────────────────────────

function tabTitle(tab: string): string {
  switch (tab) {
    case "queue":
      return "Campaign Queue";
    case "results":
      return "Results";
    case "settings":
      return "Settings";
    default:
      return "Dashboard";
  }
}

async function fetchDashboardData(
  restaurantId: string,
  setCampaigns: (data: CampaignGroup) => void,
  setResults: (data: ResultsData | null) => void,
  setIsHibernate?: (v: boolean) => void,
  setHibernateEligibility?: (v: ReactivationEligibilityData | null) => void,
) {
  try {
    const res = await fetch(`/api/dashboard/results?restaurantId=${restaurantId}`);
    const json = (await res.json()) as {
      status: string;
      data?: ResultsData | null;
    };
    if (json.status === "success") {
      const data = json.data;
      setResults(data ?? null);

      // Story 7.5: Check for hibernate mode in API response
      if ((data as Record<string, unknown> & { mode?: string })?.["mode"] === "hibernate") {
        setIsHibernate?.(true);
        const eligibility = (data as Record<string, unknown> & {
          reactivationEligibility?: ReactivationEligibilityData;
        })?.["reactivationEligibility"];
        setHibernateEligibility?.(eligibility ?? null);
      }
    }
  } catch (err) {
    console.error("Failed to fetch dashboard data:", err);
  }

  // Fetch campaigns if not hibernate
  try {
    const res = await fetch(`/api/dashboard/campaigns?restaurantId=${restaurantId}`);
    const json = (await res.json()) as {
      status: string;
      data?: CampaignGroup;
    };
    if (json.status === "success" && json.data) {
      setCampaigns(json.data);
    }
  } catch (err) {
    console.error("Failed to fetch campaigns:", err);
  }
}

async function __fetchResults(
  restaurantId: string,
  setResults: (data: ResultsData | null) => void,
) {
  try {
    const res = await fetch(`/api/dashboard/results?restaurantId=${restaurantId}`);
    const json = (await res.json()) as {
      status: string;
      data?: ResultsData | null;
    };
    if (json.status === "success") {
      setResults(json.data ?? null);
    }
  } catch (err) {
    console.error("Failed to fetch results:", err);
  }
}

async function __fetchCampaigns(
  restaurantId: string,
  setCampaigns: (data: CampaignGroup) => void
) {
  try {
    const res = await fetch(`/api/dashboard/campaigns?restaurantId=${restaurantId}`);
    const json = (await res.json()) as {
      status: string;
      data?: CampaignGroup;
    };
    if (json.status === "success" && json.data) {
      setCampaigns(json.data);
    }
  } catch (err) {
    console.error("Failed to fetch campaigns:", err);
  }
}
