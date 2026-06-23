"use client";

import React from "react";

interface LastUpdatedProps {
  lastFetchedMs: number | null;
}

/**
 * LastUpdatedIndicator — shows when the campaign data was last refreshed.
 *
 * States:
 *   - < 10s ago: "Updated just now"
 *   - < 60s ago: "Updated {n}s ago"
 *   - < 120s ago: "Updated 1m ago"
 *   - >= 120s or unknown: "Updated {n}m ago"
 *
 * DESIGN.md compliance:
 * - Inter Footnote (13px) in on-surface-variant (#717786)
 * - Fades out after 5 seconds with CSS transition
 */
export function LastUpdatedIndicator({ lastFetchedMs }: LastUpdatedProps) {
  const [visible, setVisible] = React.useState(true);
  const [label, setLabel] = React.useState("");

  React.useEffect(() => {
    if (!lastFetchedMs) {
      setLabel("");
      return;
    }

    const updateLabel = () => {
      const diffSec = Math.round((Date.now() - lastFetchedMs) / 1000);

      if (diffSec < 10) {
        setLabel("Updated just now");
      } else if (diffSec < 60) {
        setLabel(`Updated ${diffSec}s ago`);
      } else if (diffSec < 120) {
        setLabel("Updated 1m ago");
      } else if (diffSec < 3600) {
        setLabel(`Updated ${Math.round(diffSec / 60)}m ago`);
      } else if (diffSec < 86400) {
        setLabel(`Updated ${Math.round(diffSec / 3600)}h ago`);
      } else {
        setLabel("Updated a while ago");
      }
    };

    updateLabel();

    // Fade-out timer: show for 5s, then fade
    setVisible(true);
    const fadeTimer = setTimeout(() => setVisible(false), 5000);

    // Periodic re-label: update every 30s so stale labels refresh on re-renders
    const interval = setInterval(updateLabel, 30000);

    return () => {
      clearTimeout(fadeTimer);
      clearInterval(interval);
    };
  }, [lastFetchedMs]);

  if (!lastFetchedMs || !label) return null;

  return (
    <div className="px-4 text-center">
      <span
        className={`text-[13px] text-[#717786] transition-opacity duration-500 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        style={{ fontFamily: "Inter, sans-serif", lineHeight: "18px" }}
      >
        {label}
      </span>
    </div>
  );
}