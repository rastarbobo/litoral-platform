"use client";

import { useEffect } from "react";
import { useDashboardStore } from "@/store/dashboard-store";

/**
 * Server-to-client sync for subscription tier state.
 * Sets the initial lastKnownTier so post-plan-change detection works.
 */
export function TierSync({ currentTier }: { currentTier: string | null }) {
  const setLastKnownTier = useDashboardStore((s) => s.setLastKnownTier);

  useEffect(() => {
    if (currentTier) {
      setLastKnownTier(currentTier);
    }
  }, [currentTier, setLastKnownTier]);

  return null;
}
