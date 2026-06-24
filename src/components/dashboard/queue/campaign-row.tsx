import React from "react";
import Image from "next/image";
import type { CampaignWithSignedUrl } from "@/lib/dashboard/types";
import { StatusPill } from "./status-pill";
import { ChevronRight } from "lucide-react";

interface CampaignRowProps {
  campaign: CampaignWithSignedUrl;
  onClick?: (id: string) => void;
}

/**
 * Individual list row for the campaign queue.
 * Thumbnail (64x64), headline, status pill + relative date.
 * 0.5px left-inset separator (HIG pattern).
 */
export function CampaignRow({ campaign, onClick }: CampaignRowProps) {
  const relativeDate = formatRelativeDate(campaign.createdAt);

  return (
    <button
      type="button"
      onClick={() => onClick?.(campaign.id)}
      className="w-full flex items-start gap-3 py-3 px-4 text-left
                 border-b border-[#E5E5E7] last:border-b-0
                 active:bg-[#eeedf3] touch-manipulation"
      aria-label={`Campaign: ${campaign.headline ?? "Untitled"}`}
    >
      {/* Thumbnail */}
      <div className="shrink-0 w-16 h-16 rounded-xl overflow-hidden bg-[#e3e2e7]">
        {campaign.thumbnailUrl ? (
          <Image
            src={campaign.thumbnailUrl}
            alt={campaign.headline ?? "Campaign thumbnail"}
            width={64}
            height={64}
            className="w-full h-full object-cover"
            onError={(e) => {
              // On image load failure, hide the broken image and show the fallback
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="w-full h-full bg-[#e3e2e7]" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-[17px] font-normal text-[#1a1b1f] truncate leading-[22px]" style={{ fontFamily: "Inter, sans-serif" }}>
          {campaign.headline ?? "Untitled Campaign"}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <StatusPill status={campaign.status} />
          <span className="text-[13px] text-[#717786]" style={{ fontFamily: "Inter, sans-serif", lineHeight: "18px" }}>
            {relativeDate}
          </span>
        </div>
      </div>

      {/* Chevron */}
      <ChevronRight className="w-5 h-5 text-[#717786] shrink-0 self-center" />
    </button>
  );
}

function formatRelativeDate(dateInput: Date | string | number): string {
  const date = new Date(dateInput);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHrs / 24);

  if (diffDays === 0) {
    if (diffHrs === 0) return "Just now";
    return `${diffHrs}h ago`;
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
