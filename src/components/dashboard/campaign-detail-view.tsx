"use client";

import React from "react";
import Image from "next/image";
import type { Campaign } from "@/db/schema";
import { MobileAppShell } from "./mobile-app-shell";
import { Timeline, type TimelineEntry } from "./timeline";
import { CampaignActionBar } from "./campaign-action-bar";
import { useDashboardStore } from "@/store/dashboard-store";

interface CampaignDetailViewProps {
  campaign: Campaign & { restaurantName?: string | null; telegramChatId?: string | null };
  statusHistory: TimelineEntry[];
  hasRevision: boolean;
}

/**
 * Campaign Detail View — shows full campaign info.
 * Includes: asset, original vs revised caption, why-now context, status timeline.
 * "Approve from Telegram" CTA if still pending.
 */
export function CampaignDetailView({
  campaign,
  statusHistory,
  hasRevision,
}: CampaignDetailViewProps) {
  const [activeCaptionTab, setActiveCaptionTab] = React.useState<"original" | "revised">("revised");
  const restaurantId = useDashboardStore((s) => s.restaurantId);

  return (
    <MobileAppShell
      title="Campaign Detail"
      showBack
      onBackClick={() => {
        window.history.back();
      }}
    >
      <div className="flex flex-col gap-4 pt-2">
        {/* Campaign asset */}
        <div className="mx-4 rounded-xl overflow-hidden bg-[#e3e2e7] aspect-square max-h-[300px]">
          {campaign.assetUrl ? (
            <Image
              src={campaign.assetUrl}
              alt={campaign.headline ?? "Campaign asset"}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 600px"
            />
          ) : (
            <div className="w-full h-full bg-[#e3e2e7]" />
          )}
        </div>

        {/* Headline + status */}
        <div className="mx-4">
          <h1
            className="text-[22px] font-semibold text-[#1a1b1f] mb-1"
            style={{ fontFamily: "Inter, sans-serif", lineHeight: "28px" }}
          >
            {campaign.headline ?? "Untitled Campaign"}
          </h1>
          <p
            className="text-[15px] text-[#717786]"
            style={{ fontFamily: "Inter, sans-serif", lineHeight: "20px" }}
          >
            {campaign.campaignType}
          </p>
          <p
            className="text-[13px] text-[#717786] mt-0.5"
            style={{ fontFamily: "Inter, sans-serif", lineHeight: "18px" }}
          >
            Generated: {new Date(campaign.createdAt).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>

        {/* Original vs Revised caption tabs */}
        {hasRevision && (
          <div className="mx-4 flex gap-2">
            <button
              type="button"
              onClick={() => setActiveCaptionTab("original")}
              className={`px-3 py-1.5 rounded-lg text-[15px] font-medium transition-colors ${
                activeCaptionTab === "original"
                  ? "bg-[#0058bc] text-white"
                  : "bg-white text-[#717786] border border-[#E5E5E7]"
              }`}
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              Original
            </button>
            <button
              type="button"
              onClick={() => setActiveCaptionTab("revised")}
              className={`px-3 py-1.5 rounded-lg text-[15px] font-medium transition-colors ${
                activeCaptionTab === "revised"
                  ? "bg-[#0058bc] text-white"
                  : "bg-white text-[#717786] border border-[#E5E5E7]"
              }`}
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              Revised
            </button>
          </div>
        )}

        {/* Caption card */}
        <div className="mx-4 p-4 bg-white rounded-xl border border-[#E5E5E7] shadow-[0px_4px_12px_rgba(0,0,0,0.05)]">
          <p
            className="text-[17px] text-[#1a1b1f] leading-[22px] whitespace-pre-wrap"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            {campaign.caption ?? "No caption provided."}
          </p>
        </div>

        {/* "Why now" context */}
        {campaign.whyNowContext && (
          <div className="mx-4 p-4 bg-white rounded-xl border border-[#E5E5E7] shadow-[0px_4px_12px_rgba(0,0,0,0.05)]">
            <h3
              className="text-[15px] font-semibold text-[#1a1b1f] mb-1"
              style={{ fontFamily: "Inter, sans-serif", lineHeight: "20px" }}
            >
              Why now
            </h3>
            <p
              className="text-[15px] text-[#414755] leading-[20px]"
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              {campaign.whyNowContext}
            </p>
          </div>
        )}

        {/* Status timeline */}
        <div className="mx-4">
          <h3
            className="text-[15px] font-semibold text-[#1a1b1f] mb-2"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            Status
          </h3>
          <Timeline entries={statusHistory} />
        </div>

        {/* Campaign action bar — replaces "Approve from Telegram" CTA */}
        <CampaignActionBar
          campaignId={campaign.id}
          campaignStatus={campaign.status}
          restaurantId={restaurantId ?? ""}
        />
      </div>
    </MobileAppShell>
  );
}
