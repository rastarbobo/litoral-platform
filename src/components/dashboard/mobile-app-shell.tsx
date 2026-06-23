"use client";

import React from "react";
import { DashboardHeader } from "./header";
import { TabBar } from "./tab-bar";
import { useDashboardStore } from "@/store/dashboard-store";

interface MobileAppShellProps {
  children: React.ReactNode;
  title: string;
  showBack?: boolean;
  onBackClick?: () => void;
}

/**
 * MobileAppShell — layout wrapper for the mobile dashboard.
 *
 * DESIGN.md compliance:
 * - Background: #F5F5F7 canvas
 * - Inner scrollable: 16px horizontal padding on mobile, 32px on desktop
 * - Desktop: centered content up to 1200px
 * - Safe-area insets for iOS/Android
 */
export function MobileAppShell({ children, title, showBack, onBackClick }: MobileAppShellProps) {
  const error = useDashboardStore((s) => s.error);

  return (
    <div className="flex flex-col min-h-screen bg-[#F5F5F7]" style={{ fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <DashboardHeader title={title} showBack={showBack} onBackClick={onBackClick} />

      {/* Main content area */}
      <main className="flex-1 overflow-y-auto pb-20">
        {/* Error toast */}
        {error && (
          <div
            className="mx-4 mt-3 p-3 rounded-lg bg-[#ffdad6] border border-[#ba1a1a]/20 text-[#ba1a1a]
                       text-[15px] font-normal animate-in slide-in-from-top-2"
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="max-w-[1200px] mx-auto px-4 md:px-8 lg:px-8">
          {children}
        </div>
      </main>

      {/* Bottom Tab Bar */}
      <TabBar />
    </div>
  );
}
