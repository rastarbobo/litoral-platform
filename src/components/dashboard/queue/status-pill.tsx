import React from "react";

/**
 * Status tag pill for campaign queue rows.
 * Small pill-shaped badges with background color at ~10% opacity, text in full color.
 * Font: Inter Footnote 13px per DESIGN.md
 */
export function StatusPill({ status }: { status: string }) {
  const config = getStatusConfig(status);

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[13px] font-normal"
      style={{
        backgroundColor: config.bg,
        color: config.fg,
        fontFamily: "Inter, sans-serif",
        lineHeight: "18px",
      }}
    >
      {config.label}
    </span>
  );
}

function getStatusConfig(status: string): { label: string; bg: string; fg: string } {
  switch (status) {
    case "pending_approval":
    case "pending_revision":
      return { label: "Pending", bg: "rgba(158,61,0,0.12)", fg: "#9e3d00" };
    case "approved":
    case "pending_schedule":
      return { label: "Scheduled", bg: "rgba(76,74,202,0.12)", fg: "#4c4aca" };
    case "scheduled":
      return { label: "Ready", bg: "rgba(76,74,202,0.12)", fg: "#4c4aca" };
    case "published":
      return { label: "Published", bg: "rgba(36,124,84,0.12)", fg: "#247c54" };
    case "rejected":
      return { label: "Rejected", bg: "rgba(186,26,26,0.12)", fg: "#ba1a1a" };
    case "failed":
      return { label: "Failed", bg: "rgba(186,26,26,0.12)", fg: "#ba1a1a" };
    default:
      return { label: status, bg: "rgba(113,119,134,0.12)", fg: "#717786" };
  }
}
