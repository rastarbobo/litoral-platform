"use client";

import React from "react";
import { ShieldCheck, Image, FileText, Link, RefreshCw } from "lucide-react";

/**
 * Hibernate View — Story 7.5 (Task 3.1)
 *
 * Rendered when a restaurant's subscription is in Hibernate tier.
 * Shows asset preservation status and a "Reactivate Now" button.
 *
 * Cupertino Logic design tokens per UX-DR1–DR6:
 * - Level 1 card on #F5F5F7 canvas
 * - Inter typography throughout
 * - Primary button #005bc1
 */

export interface ReactivationEligibilityData {
  campaignsGenerated: number;
  lastCampaignAt: string | null;
  r2AssetCount: number;
  r2TotalSizeBytes: number;
  hasBrandPersona: boolean;
  connectedPlatforms: string[];
  eligibleForReactivation: boolean;
  reactivationGracePeriodEnds: string | null;
}

interface HibernateViewProps {
  restaurantName?: string;
  eligibility?: ReactivationEligibilityData | null;
  onReactivate?: () => void;
  isReactivating?: boolean;
}

export function HibernateView({
  restaurantName = "Your restaurant",
  eligibility,
  onReactivate,
  isReactivating = false,
}: HibernateViewProps) {
  const formatDate = (isoString: string | null): string => {
    if (!isoString) return "N/A";
    return new Date(isoString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] px-4 py-12">
      {/* Main card */}
      <div
        className="w-full max-w-md bg-white rounded-xl border border-[#E5E5E7]
                   shadow-[0px_4px_12px_rgba(0,0,0,0.05)] p-8 text-center"
      >
        {/* Icon */}
        <div className="mb-6">
          <div
            className="inline-flex items-center justify-center w-16 h-16
                         rounded-full bg-[#E3F2FD]"
          >
            <ShieldCheck className="w-8 h-8 text-[#0058bc]" />
          </div>
        </div>

        {/* Heading */}
        <h1
          className="text-[20px] font-bold text-[#1a1b1f] mb-3"
          style={{ fontFamily: "Inter, sans-serif", lineHeight: "26px" }}
        >
          Your subscription is paused
        </h1>

        {/* Body */}
        <p
          className="text-[17px] text-[#414755] mb-8 leading-[22px]"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          {restaurantName} is in Hibernate mode. Your campaigns are on hold and
          your assets are safely preserved. Reactivate anytime to pick up right
          where you left off.
        </p>

        {/* Asset summary card */}
        {eligibility && (
          <div
            className="bg-[#F5F5F7] rounded-lg p-4 mb-8 text-left"
          >
            <h2
              className="text-[15px] font-semibold text-[#1a1b1f] mb-3"
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              Your preserved assets
            </h2>
            <div className="flex flex-col gap-2">
              {/* Campaigns */}
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#717786] flex-shrink-0" />
                <span
                  className="text-[15px] text-[#414755]"
                  style={{ fontFamily: "Inter, sans-serif" }}
                >
                  📊 {eligibility.campaignsGenerated} campaign
                  {eligibility.campaignsGenerated !== 1 ? "s" : ""} generated
                </span>
              </div>

              {/* R2 Assets */}
              <div className="flex items-center gap-2">
                <Image className="w-4 h-4 text-[#717786] flex-shrink-0" />
                <span
                  className="text-[15px] text-[#414755]"
                  style={{ fontFamily: "Inter, sans-serif" }}
                >
                  🎨 {eligibility.r2AssetCount} creative asset
                  {eligibility.r2AssetCount !== 1 ? "s" : ""} stored
                  {eligibility.r2TotalSizeBytes > 0
                    ? ` (${formatBytes(eligibility.r2TotalSizeBytes)})`
                    : ""}
                </span>
              </div>

              {/* Brand Persona */}
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#717786] flex-shrink-0" />
                <span
                  className="text-[15px] text-[#414755]"
                  style={{ fontFamily: "Inter, sans-serif" }}
                >
                  📝 Brand persona:{" "}
                  {eligibility.hasBrandPersona ? "Saved" : "Not configured"}
                </span>
              </div>

              {/* Platforms */}
              <div className="flex items-center gap-2">
                <Link className="w-4 h-4 text-[#717786] flex-shrink-0" />
                <span
                  className="text-[15px] text-[#414755]"
                  style={{ fontFamily: "Inter, sans-serif" }}
                >
                  🔗 Connected to:{" "}
                  {eligibility.connectedPlatforms.length > 0
                    ? eligibility.connectedPlatforms.join(", ")
                    : "No platforms"}
                </span>
              </div>
            </div>

            {/* Grace period */}
            {eligibility.reactivationGracePeriodEnds && (
              <p
                className="text-[13px] text-[#717786] mt-3 pt-3 border-t border-[#E5E5E7]"
                style={{ fontFamily: "Inter, sans-serif" }}
              >
                Data preserved until{" "}
                {formatDate(eligibility.reactivationGracePeriodEnds)}
              </p>
            )}
          </div>
        )}

        {/* Reactivate button */}
        {eligibility?.eligibleForReactivation !== false && (
          <button
            onClick={onReactivate}
            disabled={isReactivating}
            className="w-full py-3 px-6 rounded-lg font-semibold text-[17px]
                       bg-[#0058bc] text-white
                       hover:bg-[#004a9f] active:scale-[0.98]
                       transition-all duration-150
                       disabled:opacity-50 disabled:cursor-not-allowed
                       flex items-center justify-center gap-2"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            {isReactivating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Reactivating...
              </>
            ) : (
              "Reactivate Now"
            )}
          </button>
        )}

        {/* Footer */}
        <p
          className="text-[13px] text-[#717786] mt-6"
          style={{ fontFamily: "Inter, sans-serif", lineHeight: "18px" }}
        >
          Your data is preserved. No charges during Hibernate.
        </p>
      </div>
    </div>
  );
}