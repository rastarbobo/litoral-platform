"use client";

import React from "react";
import { useDashboardStore } from "@/store/dashboard-store";
import type { DashboardTab } from "@/lib/dashboard/types";
import { Inbox, BarChart3, Settings } from "lucide-react";

const tabs: { key: DashboardTab; label: string; Icon: React.ElementType }[] = [
  { key: "queue", label: "Queue", Icon: Inbox },
  { key: "results", label: "Results", Icon: BarChart3 },
  { key: "settings", label: "Settings", Icon: Settings },
];

/**
 * Bottom Tab Bar — fixed to the bottom of the viewport.
 * 3 tabs: Queue, Results, Settings.
 * Active tab: primary blue icon + label.
 * Inactive: on-surface-variant grayish.
 * Level 2 elevation per Cupertino Logic (DESIGN.md).
 */
export function TabBar() {
  const activeTab = useDashboardStore((s) => s.activeTab);
  const setActiveTab = useDashboardStore((s) => s.setActiveTab);

  return (
    <nav
      aria-label="Dashboard navigation"
      className="fixed bottom-0 left-0 right-0 z-50 h-12 flex items-center justify-around
                 bg-white border-t border-[#E5E5E7] backdrop-blur-[20px]
                 shadow-[0px_-4px_12px_rgba(0,0,0,0.05)]
                 [padding-bottom:env(safe-area-inset-bottom)]">
      {tabs.map(({ key, label, Icon }) => {
        const isActive = activeTab === key;
        return (
          <button
            type="button"
            key={key}
            onClick={() => setActiveTab(key)}
            className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full
                       min-w-[64px] touch-manipulation"
            aria-current={isActive ? "page" : undefined}
            aria-label={label}
          >
            <Icon
              className="w-6 h-6"
              style={{
                color: isActive ? "#0058bc" : "#717786",
              }}
            />
            <span
              className="text-[12px] font-semibold uppercase tracking-[0.05em]"
              style={{
                color: isActive ? "#0058bc" : "#717786",
                fontFamily: "Inter, sans-serif",
              }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
