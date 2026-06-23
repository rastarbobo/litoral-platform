"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

interface DashboardHeaderProps {
  title: string;
  showBack?: boolean;
  onBackClick?: () => void;
}

/**
 * Sticky top header for the mobile dashboard.
 * Minimal: restaurant name as page title, conditional back chevron.
 * Font: Inter Title-2 (20px/600 per DESIGN.md)
 */
export function DashboardHeader({ title, showBack, onBackClick }: DashboardHeaderProps) {
  const router = useRouter();

  const handleBack = () => {
    if (onBackClick) {
      onBackClick();
      return;
    }
    router.back();
  };

  return (
    <header
      className="sticky top-0 z-40 flex h-14 items-center gap-2 px-4
                 bg-white/80 backdrop-blur-[8px] border-b border-[#E5E5E7]/50"
    >
      {showBack && (
        <button
          onClick={handleBack}
          className="flex items-center justify-center w-10 h-10 -ml-2 touch-manipulation"
          aria-label="Back"
        >
          <ChevronLeft className="w-5 h-5 text-[#1a1b1f]" />
        </button>
      )}
      <h1
        className="text-[20px] font-semibold text-[#1a1b1f] flex-1 truncate pl-0"
        style={{ fontFamily: "Inter, sans-serif", lineHeight: "25px" }}
      >
        {title}
      </h1>
    </header>
  );
}
