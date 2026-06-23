"use client";

import React from "react";
import { toast } from "sonner";
import { useDashboardStore } from "@/store/dashboard-store";
import type { CampaignAction } from "@/lib/dashboard/types";

interface CampaignActionBarProps {
  campaignId: string;
  campaignStatus: string;
  restaurantId: string;
}

/**
 * CampaignActionBar — action buttons for campaign management.
 *
 * Only shown for pending_approval campaigns.
 * Buttons: ✅ Approve, 💬 Request Revision, ❌ Reject
 *
 * For other statuses, shows a status badge only.
 *
 * DESIGN.md compliance:
 * - Primary: solid blue bg (#0058bc) + white text
 * - Secondary: outlined with blue text
 * - Ghost: no bg, destructive red text
 * - All buttons: rounded-xl (16px), min 44px touch target
 */
export function CampaignActionBar({
  campaignId,
  campaignStatus,
  restaurantId,
}: CampaignActionBarProps) {
  const actionInFlight = useDashboardStore((s) => s.actionInFlight);
  const performAction = useDashboardStore((s) => s.performAction);
  const isInFlight = !!actionInFlight[campaignId];

  const [showRevisionInput, setShowRevisionInput] = React.useState(false);
  const [revisionText, setRevisionText] = React.useState("");
  const [isRestoring, setIsRestoring] = React.useState(false);

  const handleAction = async (action: CampaignAction, extra?: Record<string, string>) => {
    try {
      await performAction(campaignId, action, restaurantId, extra);
      toast.success(actionLabel(action) + " ✓", {
        duration: 3000,
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `Failed to ${action}`,
        { duration: 5000 },
      );
    }
  };

  const handleRestoreToPending = async () => {
    if (!window.confirm("Restore this campaign to pending approval?")) {
      return;
    }
    setIsRestoring(true);
    try {
      const res = await fetch(`/api/dashboard/campaigns/${campaignId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending_approval" }),
      });
      const json = (await res.json()) as { status: string; message?: string };
      if (json.status === "success") {
        toast.success("Campaign restored to pending ✓", { duration: 3000 });
      } else {
        throw new Error(json.message ?? "Failed to restore campaign");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to restore", { duration: 5000 });
    } finally {
      setIsRestoring(false);
    }
  };

  const handleRevisionSubmit = () => {
    if (!revisionText.trim()) return;
    handleAction("request_revision", { revisionInstructions: revisionText.trim() });
    setShowRevisionInput(false);
    setRevisionText("");
  };

  const isBusy = isInFlight || isRestoring;

  // For rejected campaigns: show status badge + restore button
  if (campaignStatus === "rejected") {
    return (
      <div className="mx-4 pb-4 flex flex-col gap-3">
        <StatusBadge status="rejected" />
        <button
          type="button"
          onClick={handleRestoreToPending}
          disabled={isBusy}
          className="w-full py-3 px-4 rounded-xl border border-[#0058bc] bg-white text-[#0058bc]
                     text-[17px] font-semibold active:bg-[#f4f3f8] touch-manipulation
                     min-h-[44px] disabled:opacity-50 transition-colors"
          style={{ fontFamily: "Inter, sans-serif", lineHeight: "22px" }}
        >
          {isRestoring ? <Spinner /> : "Restore to Pending"}
        </button>
      </div>
    );
  }

  // For all non-pending statuses other than rejected: just the status badge
  if (campaignStatus !== "pending_approval") {
    return (
      <div className="mx-4 pb-4">
        <StatusBadge status={campaignStatus} />
      </div>
    );
  }

  // ── pending_approval: show all action buttons ──
  return (
    <div className="mx-4 pb-4 flex flex-col gap-3">
      {/* Approve button */}
      <button
        type="button"
        onClick={() => handleAction("approve")}
        disabled={isBusy}
        className="w-full py-3 px-4 rounded-xl bg-[#0058bc] text-white
                   text-[17px] font-semibold active:bg-[#004493] touch-manipulation
                   min-h-[44px] disabled:opacity-50 transition-colors
                   flex items-center justify-center gap-2"
        style={{ fontFamily: "Inter, sans-serif", lineHeight: "22px" }}
      >
        {isInFlight && actionInFlight[campaignId] === "approve" ? (
          <Spinner />
        ) : (
          "✅"
        )}
        Approve
      </button>

      {/* Request Revision button + inline input */}
      {!showRevisionInput ? (
        <button
          type="button"
          onClick={() => setShowRevisionInput(true)}
          disabled={isBusy}
          className="w-full py-3 px-4 rounded-xl border border-[#0058bc] bg-white text-[#0058bc]
                     text-[17px] font-semibold active:bg-[#f4f3f8] touch-manipulation
                     min-h-[44px] disabled:opacity-50 transition-colors
                     flex items-center justify-center gap-2"
          style={{ fontFamily: "Inter, sans-serif", lineHeight: "22px" }}
        >
          💬 Request Revision
        </button>
      ) : (
        <div className="bg-white rounded-xl border border-[#E5E5E7] p-3 shadow-[0px_4px_12px_rgba(0,0,0,0.05)]">
          <textarea
            value={revisionText}
            onChange={(e) => setRevisionText(e.target.value)}
            placeholder="What would you like to change? (e.g. 'make it punchier')"
            className="w-full p-3 rounded-lg border border-[#D1D1D6] bg-white
                       text-[17px] text-[#1a1b1f] placeholder:text-[#c1c6d7]
                       focus:border-[#0058bc] focus:ring-0 focus:outline-none
                       min-h-[80px] resize-none"
            style={{ fontFamily: "Inter, sans-serif", lineHeight: "22px" }}
            autoFocus
          />
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={handleRevisionSubmit}
              disabled={!revisionText.trim() || isBusy}
              className="flex-1 py-2.5 px-3 rounded-lg bg-[#0058bc] text-white
                         text-[15px] font-semibold active:bg-[#004493] touch-manipulation
                         min-h-[44px] disabled:opacity-50 transition-colors"
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              {isInFlight && actionInFlight[campaignId] === "request_revision" ? (
                <Spinner />
              ) : (
                "Send"
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowRevisionInput(false);
                setRevisionText("");
              }}
              disabled={isBusy}
              className="py-2.5 px-4 rounded-lg border border-[#D1D1D6] bg-white text-[#717786]
                         text-[15px] font-medium active:bg-[#f4f3f8] touch-manipulation
                         min-h-[44px] disabled:opacity-50 transition-colors"
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Reject button with reason dropdown */}
      <RejectButtonGroup
        campaignId={campaignId}
        restaurantId={restaurantId}
        isBusy={isBusy}
      />
    </div>
  );
}

// ─── RejectButtonGroup — with reason dropdown ────────────────────

function RejectButtonGroup({
  campaignId,
  restaurantId,
  isBusy,
}: {
  campaignId: string;
  restaurantId: string;
  isRejectInFlight: boolean;
}) {
  const [showPicker, setShowPicker] = React.useState(false);
  const performAction = useDashboardStore((s) => s.performAction);

  const handleReject = async (reason: string) => {
    setShowPicker(false);
    try {
      await performAction(campaignId, "reject", restaurantId, { rejectReason: reason });
      toast.success("Campaign rejected ✓", { duration: 3000 });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to reject campaign",
        { duration: 5000 },
      );
    }
  };

  if (!showPicker) {
    return (
      <button
        type="button"
        onClick={() => setShowPicker(true)}
        disabled={isBusy}
        className="w-full py-3 px-4 rounded-xl bg-transparent text-[#ba1a1a]
                   text-[17px] font-medium active:bg-[#ffdad6] touch-manipulation
                   min-h-[44px] disabled:opacity-50 transition-colors
                   flex items-center justify-center gap-2"
        style={{ fontFamily: "Inter, sans-serif", lineHeight: "22px" }}
      >
        ❌ Reject
      </button>
    );
  }

  const reasons = [
    { value: "not_my_style", label: "Not my style" },
    { value: "wrong_offer", label: "Wrong offer" },
    { value: "too_soon", label: "Too soon" },
    { value: "other", label: "Other" },
  ];

  return (
    <div className="flex flex-col gap-2">
      <p
        className="text-[13px] text-[#717786] px-1"
        style={{ fontFamily: "Inter, sans-serif", lineHeight: "18px" }}
      >
        Why are you rejecting this campaign?
      </p>
      {reasons.map((r) => (
        <button
          key={r.value}
          type="button"
          onClick={() => handleReject(r.value)}
          disabled={isBusy}
          className="w-full text-left py-3 px-4 rounded-xl border border-[#E5E5E7] bg-white
                     text-[15px] text-[#1a1b1f] font-medium active:bg-[#f4f3f8]
                     touch-manipulation min-h-[44px] disabled:opacity-50 transition-colors"
          style={{ fontFamily: "Inter, sans-serif", lineHeight: "22px" }}
        >
          {r.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setShowPicker(false)}
        disabled={isBusy}
        className="py-2.5 px-4 rounded-xl text-[15px] font-medium text-[#717786]
                   active:text-[#1a1b1f] touch-manipulation min-h-[44px]"
        style={{ fontFamily: "Inter, sans-serif" }}
      >
        Cancel
      </button>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────

function actionLabel(action: CampaignAction): string {
  switch (action) {
    case "approve":
      return "Campaign approved";
    case "reject":
      return "Campaign rejected";
    case "request_revision":
      return "Revision requested";
  }
}

function Spinner() {
  return (
    <span className="inline-block w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
  );
}

// ─── Status Badge ────────────────────────────────────────

interface StatusBadgeProps {
  status: string;
}

function StatusBadge({ status }: StatusBadgeProps) {
  const { label, bg, text } = statusConfig(status);

  return (
    <div
      className="px-4 py-3 rounded-xl text-center"
      style={{ backgroundColor: bg }}
    >
      <span
        className="text-[15px] font-semibold"
        style={{ fontFamily: "Inter, sans-serif", color: text }}
      >
        {label}
      </span>
    </div>
  );
}

function statusConfig(status: string): { label: string; bg: string; text: string } {
  switch (status) {
    case "approved":
      return { label: "✓ Approved — ready to schedule", bg: "#e8f5e9", text: "#2e7d32" };
    case "scheduled":
    case "pending_schedule":
      return { label: "📅 Scheduled", bg: "#ede7f6", text: "#4527a0" };
    case "published":
      return { label: "📢 Published", bg: "#e3f2fd", text: "#1565c0" };
    case "rejected":
      return { label: "❌ Rejected", bg: "#fce4ec", text: "#c62828" };
    case "pending_revision":
      return { label: "💬 Awaiting revision by AI…", bg: "#fff3e0", text: "#e65100" };
    case "failed":
      return { label: "⚠️ Failed", bg: "#fce4ec", text: "#c62828" };
    default:
      return { label: status, bg: "#f5f5f7", text: "#717786" };
  }
}
