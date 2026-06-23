"use client";

import { useEffect } from "react";
import { useDashboardStore } from "@/store/dashboard-store";
import { TIER_LABELS } from "@/lib/subscription/tiers";

/**
 * Displays a "Plan updated" banner when the user returns from Stripe
 * after changing their subscription tier.
 *
 * Compares current tier (from server) against lastKnownTier in Zustand.
 * If they differ, shows a success banner and updates lastKnownTier.
 */
export function PlanUpdatedBanner({ currentTier }: { currentTier: string | null }) {
  const lastKnownTier = useDashboardStore((s) => s.lastKnownTier);
  const setLastKnownTier = useDashboardStore((s) => s.setLastKnownTier);

  useEffect(() => {
    // Set initial lastKnownTier on first load
    if (currentTier && !lastKnownTier) {
      setLastKnownTier(currentTier);
    }
  }, [currentTier, lastKnownTier, setLastKnownTier]);

  // Only show banner if tier changed since last known
  const showBanner =
    currentTier !== null &&
    lastKnownTier !== null &&
    currentTier !== lastKnownTier;

  if (!showBanner) return null;

  const tierName = TIER_LABELS[currentTier] ?? currentTier;

  return (
    <div className="fixed top-0 inset-x-0 z-50 p-4">
      <div className="max-w-2xl mx-auto bg-[#0070eb]/10 border border-[#0070eb]/20 rounded-[12px] p-4 flex items-center gap-3">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#0070eb"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        <p className="text-[15px] font-medium text-[#005bc1]">
          Your plan has been updated to {tierName} 🎉
        </p>
      </div>
    </div>
  );
}
