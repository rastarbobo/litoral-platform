"use client";

import React from "react";
// Check icon reserved for future timeline variants
// import { Check } from "lucide-react";

export interface TimelineEntry {
  status: string;
  label: string;
  date: Date | null;
  isComplete: boolean;
}

/**
 * Vertical status timeline used in Campaign Detail.
 * Visual: connecting line with dots + labels + timestamps.
 */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-col gap-0 relative">
      {entries.map((entry, index) => {
        const isLast = index === entries.length - 1;
        const isActive = entry.isComplete;

        return (
          <div key={`status-${entry.status}-${index}`} className="flex items-start gap-3 relative">
            {/* Line connecting to next */}
            {!isLast && (
              <div
                className={`absolute left-[18px] top-8 w-[2px] h-[calc(100%-16px)] ${
                  isActive ? "bg-[#0058bc]" : "bg-[#E5E5E7]"
                }`}
              />
            )}

            {/* Dot */}
            <div
              className={`relative z-10 w-3 h-3 rounded-full mt-1.5 shrink-0 ${
                isActive ? "bg-[#0058bc]" : "bg-[#E5E5E7]"
              }`}
            />

            {/* Label + date */}
            <div className="flex-1 min-w-0 pb-5">
              <p
                className={`text-[17px] leading-[22px] ${
                  isActive ? "text-[#1a1b1f] font-normal" : "text-[#717786] font-normal"
                }`}
                style={{ fontFamily: "Inter, sans-serif" }}
              >
                {entry.label}
              </p>
              {entry.date && (
                <p
                  className="text-[13px] text-[#717786] mt-0.5"
                  style={{ fontFamily: "Inter, sans-serif", lineHeight: "18px" }}
                >
                  {new Date(entry.date).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
