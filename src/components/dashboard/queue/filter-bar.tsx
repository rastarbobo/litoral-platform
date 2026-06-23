"use client";

import React from "react";
import { ChevronDown } from "lucide-react";
import type { SortOption, CampaignTypeFilter, SourceFilter } from "@/lib/dashboard/types";

interface FilterBarProps {
  sort: SortOption;
  campaignType: CampaignTypeFilter;
  source: SourceFilter;
  onSortChange: (sort: SortOption) => void;
  onCampaignTypeChange: (type: CampaignTypeFilter) => void;
  onSourceChange: (source: SourceFilter) => void;
}

/**
 * FilterBar — sort & filter controls for the Campaign Queue.
 *
 * DESIGN.md compliance:
 * - Sticky below header
 * - Inter Footnote (13px/400) typography
 * - Active pill: primary blue bg (#0058bc) + white text
 * - Inactive pill: surface-container-high (#e9e7ed) + on-surface text
 * - Horizontally scrollable type chips
 * - 8px gap between chips
 */
export function FilterBar({
  sort,
  campaignType,
  source,
  onSortChange,
  onCampaignTypeChange,
  onSourceChange,
}: FilterBarProps) {
  const [showSortMenu, setShowSortMenu] = React.useState(false);

  const campaignTypes: { value: CampaignTypeFilter; label: string }[] = [
    { value: "all", label: "All Types" },
    { value: "flash_offer", label: "Flash Offer" },
    { value: "seasonal_event", label: "Seasonal" },
    { value: "daily_special", label: "Daily Special" },
    { value: "brand_awareness", label: "Brand" },
  ];

  const sources: { value: SourceFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "autonomous", label: "Auto-generated" },
    { value: "owner_initiated", label: "My Submissions" },
  ];

  const sortLabel = sort === "created_at_desc" ? "Newest first" : "Oldest first";

  return (
    <div className="sticky top-0 z-10 bg-[#F5F5F7] pb-3">
      {/* Sort row */}
      <div className="px-4 flex items-center justify-between">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowSortMenu(!showSortMenu)}
            className="flex items-center gap-1 text-[13px] text-[#717786] py-1.5 px-2 rounded-lg
                       active:bg-[#e9e7ed] touch-manipulation min-h-[32px] transition-colors"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            {sortLabel}
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          {showSortMenu && (
            <>
              {/* Backdrop to close */}
              <div
                className="fixed inset-0 z-20"
                onClick={() => setShowSortMenu(false)}
              />
              <div className="absolute top-full left-0 mt-1 z-30 bg-white rounded-xl border border-[#E5E5E7]
                              shadow-[0px_8px_24px_rgba(0,0,0,0.12)] overflow-hidden min-w-[160px]">
                {(["created_at_desc", "created_at_asc"] as SortOption[]).map((opt) => (
                  <button
                    type="button"
                    key={opt}
                    onClick={() => {
                      onSortChange(opt);
                      setShowSortMenu(false);
                    }}
                    className={`block w-full text-left px-4 py-2.5 text-[15px] transition-colors
                                ${sort === opt ? "bg-[#e8f0fe] text-[#0058bc] font-semibold" : "text-[#1a1b1f]"}`}
                    style={{ fontFamily: "Inter, sans-serif" }}
                  >
                    {opt === "created_at_desc" ? "Newest first" : "Oldest first"}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Campaign type chips — horizontally scrollable */}
      <div className="px-4 mt-2 flex gap-2 overflow-x-auto scrollbar-hide">
        {campaignTypes.map(({ value, label }) => (
          <button
            type="button"
            key={value}
            onClick={() => onCampaignTypeChange(value)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors
                        touch-manipulation min-h-[32px]
                        ${
                          campaignType === value
                            ? "bg-[#0058bc] text-white"
                            : "bg-[#e9e7ed] text-[#1a1b1f] active:bg-[#d1d0d6]"
                        }`}
            style={{ fontFamily: "Inter, sans-serif", lineHeight: "16px" }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Source toggle */}
      <div className="px-4 mt-2 flex gap-2">
        {sources.map(({ value, label }) => (
          <button
            type="button"
            key={value}
            onClick={() => onSourceChange(value)}
            className={`px-3 py-1 rounded-full text-[13px] font-medium transition-colors
                        touch-manipulation min-h-[32px]
                        ${
                          source === value
                            ? "bg-[#0058bc] text-white"
                            : "bg-[#e9e7ed] text-[#1a1b1f] active:bg-[#d1d0d6]"
                        }`}
            style={{ fontFamily: "Inter, sans-serif", lineHeight: "16px" }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}