"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useDashboardStore } from "@/store/dashboard-store";
import type { CampaignWithSignedUrl, SortOption, CampaignTypeFilter, SourceFilter } from "@/lib/dashboard/types";
import { CampaignRow } from "./campaign-row";
import { FilterBar } from "./filter-bar";
import { LastUpdatedIndicator } from "./last-updated";

interface CampaignQueueListProps {
  restaurantId: string;
  initialCampaigns?: {
    pending: CampaignWithSignedUrl[];
    scheduled: CampaignWithSignedUrl[];
    published: CampaignWithSignedUrl[];
  };
}

/**
 * Campaign Queue List — the main Queue tab content.
 * Groups campaigns by status: PENDING, SCHEDULED, PUBLISHED, REJECTED.
 * Includes filter/sort bar and "last updated" indicator.
 *
 * Section headers use Inter Label-Caps (12px/600/0.05em tracking) per DESIGN.md.
 * Empty state: centered "No campaigns yet" with light gray icon.
 */
export function CampaignQueueList({ restaurantId, initialCampaigns }: CampaignQueueListProps) {
  const router = useRouter();
  const campaigns = useDashboardStore((s) => s.campaigns);
  const setCampaigns = useDashboardStore((s) => s.setCampaigns);
  const isLoading = useDashboardStore((s) => s.isLoading);
  const filters = useDashboardStore((s) => s.filters);
  const setFilters = useDashboardStore((s) => s.setFilters);
  const lastFetchedAt = useDashboardStore((s) => s.lastFetchedAt);

  // Initialise with SSR data if available
  React.useEffect(() => {
    if (initialCampaigns) {
      setCampaigns(initialCampaigns);
    }
  }, [initialCampaigns, setCampaigns]);

  // Client-side fetch with filter/sort params
  const refresh = React.useCallback(async (opts?: {
    sort?: SortOption;
    campaignType?: CampaignTypeFilter;
    source?: SourceFilter;
  }) => {
    const currentSort = opts?.sort ?? filters.sort;
    const currentType = opts?.campaignType ?? filters.campaignType;
    const currentSource = opts?.source ?? filters.source;

    useDashboardStore.getState().setLoading(true);

    try {
      const params = new URLSearchParams({ restaurantId });
      params.set("sort", currentSort);
      if (currentType !== "all") params.set("campaignType", currentType);
      if (currentSource !== "all") params.set("source", currentSource);

      const res = await fetch(`/api/dashboard/campaigns?${params.toString()}`);
      const json = (await res.json()) as {
        status: string;
        data?: { pending: never[]; scheduled: never[]; published: never[]; rejected?: never[] };
      };
      if (json.status === "success" && json.data) {
        useDashboardStore.getState().setCampaigns(json.data as {
          pending: never[];
          scheduled: never[];
          published: never[];
        });
        useDashboardStore.getState().setLastFetchedAt(Date.now());
      }
    } catch (err) {
      console.error("Campaign queue refresh failed:", err);
    } finally {
      useDashboardStore.getState().setLoading(false);
    }
  }, [restaurantId, filters.sort, filters.campaignType, filters.source]);

  // Refresh when filters change
  React.useEffect(() => {
    refresh();
  }, [filters.sort, filters.campaignType, filters.source]);

  const handleRowClick = (id: string) => {
    router.push(`/dashboard/campaign/${id}`);
  };

  const displayData = campaigns ?? { pending: [], scheduled: [], published: [] };

  return (
    <div className="flex flex-col">
      {/* Filter & Sort Bar */}
      <FilterBar
        sort={filters.sort}
        campaignType={filters.campaignType}
        source={filters.source}
        onSortChange={(sort) => setFilters({ ...filters, sort })}
        onCampaignTypeChange={(campaignType) => setFilters({ ...filters, campaignType })}
        onSourceChange={(source) => setFilters({ ...filters, source })}
      />

      {/* Loading indicator */}
      {isLoading && (
        <div className="px-4 py-2 text-center text-[13px] text-[#717786]" style={{ fontFamily: "Inter, sans-serif" }}>
          Loading…
        </div>
      )}

      {/* Last updated */}
      <LastUpdatedIndicator lastFetchedMs={lastFetchedAt} />

      {/* Pending */}
      <CampaignSection
        title="Pending"
        campaigns={displayData.pending}
        emptyMessage="No pending campaigns"
        onRowClick={handleRowClick}
      />

      {/* Scheduled */}
      <CampaignSection
        title="Scheduled"
        campaigns={displayData.scheduled}
        emptyMessage="No scheduled campaigns"
        onRowClick={handleRowClick}
      />

      {/* Published */}
      <CampaignSection
        title="Published"
        campaigns={displayData.published}
        emptyMessage="No published campaigns"
        onRowClick={handleRowClick}
      />
    </div>
  );
}

// ─── Section sub-component ─────────────────────────────

interface SectionProps {
  title: string;
  campaigns: CampaignWithSignedUrl[];
  emptyMessage: string;
  onRowClick: (id: string) => void;
}

function CampaignSection({ title, campaigns, emptyMessage, onRowClick }: SectionProps) {
  const hasItems = campaigns.length > 0;

  return (
    <section className="mb-4">
      {/* Section header — Label-Caps per DESIGN.md */}
      <h2
        className="px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.05em] text-[#717786]"
        style={{ fontFamily: "Inter, sans-serif", lineHeight: "16px" }}
      >
        {title} ({campaigns.length})
      </h2>

      {/* Card container — Level 1 elevation */}
      <div className="mx-4
                      bg-white rounded-xl border border-[#E5E5E7]
                      shadow-[0px_4px_12px_rgba(0,0,0,0.05)]
                      overflow-hidden">
        {hasItems ? (
          campaigns.map((campaign) => (
            <CampaignRow
              key={campaign.id}
              campaign={campaign}
              onClick={onRowClick}
            />
          ))
        ) : (
          <div className="px-4 py-8 text-center">
            <p className="text-[16px] text-[#717786]" style={{ fontFamily: "Inter, sans-serif", lineHeight: "21px" }}>
              {emptyMessage}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}