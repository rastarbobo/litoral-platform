"use client";

import React from "react";
import type { ResultsData } from "@/lib/dashboard/types";
import {
  TrendingUp,
  TrendingDown,
  Sparkles,
  Target,
  CalendarDays,
  Shield,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

/**
 * Results View — "One Extra Table" ROI cards.
 * Three cards: This Week (reach), ROI framing, Analyst Insight.
 * Plus optional 4th card for season comparison (Story 7.1).
 * All cards: Level 1 elevation per DESIGN.md.
 *
 * When `data` is undefined (initial load), shows a loading skeleton.
 * When `data` is null or empty, shows an empty state.
 */
export function ResultsView({ data }: { data?: ResultsData | null }) {
  const [loading, setLoading] = React.useState(data === undefined);

  React.useEffect(() => {
    if (data !== undefined) {
      setLoading(false);
    }
  }, [data]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard /> {/* Season comparison skeleton */}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <p className="text-[16px] text-[#717786]" style={{ fontFamily: "Inter, sans-serif" }}>
          No results data available yet. Data will appear here once campaigns are published.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Card 1 — "This Week" */}
      <Level1Card>
        <h2
          className="text-[24px] font-bold text-[#1a1b1f] mb-3"
          style={{ fontFamily: "Inter, sans-serif", lineHeight: "30px" }}
        >
          This Week
        </h2>
        <div className="flex items-baseline gap-2">
          <span
            className="text-[34px] font-bold text-[#1a1b1f]"
            style={{ fontFamily: "Inter, sans-serif", lineHeight: "41px" }}
          >
            {data.thisWeek.estimatedReach.toLocaleString()}
          </span>
          <span className="text-[15px] text-[#717786]" style={{ fontFamily: "Inter, sans-serif" }}>
            est. reach
          </span>
        </div>
        <div className="flex items-center gap-1 mt-2">
          {data.thisWeek.percentChange >= 0 ? (
            <TrendingUp className="w-4 h-4 text-[#247c54]" />
          ) : (
            <TrendingDown className="w-4 h-4 text-[#ba1a1a]" />
          )}
          <span
            className={`text-[15px] font-medium ${
              data.thisWeek.percentChange >= 0 ? "text-[#247c54]" : "text-[#ba1a1a]"
            }`}
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            {data.thisWeek.percentChange >= 0 ? "+" : ""}
            {data.thisWeek.percentChange}%
          </span>
          <span className="text-[13px] text-[#717786]" style={{ fontFamily: "Inter, sans-serif" }}>
            vs last week
          </span>
        </div>
      </Level1Card>

      {/* Card 2 — "One Extra Table" */}
      <Level1Card>
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-5 h-5 text-[#0058bc]" />
          <h2
            className="text-[24px] font-bold text-[#1a1b1f]"
            style={{ fontFamily: "Inter, sans-serif", lineHeight: "30px" }}
          >
            One Extra Table
          </h2>
        </div>
        <p
          className="text-[17px] text-[#414755] leading-[22px]"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          {data.oneExtraTable.text}
        </p>
      </Level1Card>

      {/* Card 3 — Analyst Insight */}
      <Level1Card>
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-5 h-5 text-[#0058bc]" />
          <h2
            className="text-[24px] font-bold text-[#1a1b1f]"
            style={{ fontFamily: "Inter, sans-serif", lineHeight: "30px" }}
          >
            Analyst Insight
          </h2>
        </div>
        <p
          className="text-[16px] text-[#414755] leading-[21px] italic"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          &ldquo;{data.analystInsight.quote}&rdquo;
        </p>
        <p
          className="text-[13px] text-[#717786] mt-2"
          style={{ fontFamily: "Inter, sans-serif", lineHeight: "18px" }}
        >
          — AI Analyst, this week
        </p>
      </Level1Card>

      {/* Card 4 — Season Comparison (Story 7.1) */}
      {data.seasonComparison !== undefined && (
        <SeasonComparisonCard seasonComparison={data.seasonComparison} />
      )}

      {/* Guardian Mode Banner (Story 7.3, AC 4) */}
      {data.guardianMode?.enabled && (
        <GuardianModeBanner guardianMode={data.guardianMode} />
      )}

      {/* Pre-Season Booking Intent Banner (Story 7.4, AC 4) */}
      {data.preSeasonBooking !== null && data.preSeasonBooking !== undefined && data.preSeasonBooking.clicks > 0 && (
        <PreSeasonBookingBanner clicks={data.preSeasonBooking.clicks} />
      )}

      {/* Card 5 — Guardian Report (Story 7.3, AC 3) */}
      {data.guardianReport && (
        <GuardianReportCard report={data.guardianReport} />
      )}
    </div>
  );
}

// ── Season Comparison subcomponent ─────────────────

function SeasonComparisonCard({
  seasonComparison,
}: {
  seasonComparison: NonNullable<ResultsData["seasonComparison"]>;
}) {
  if (seasonComparison === null) {
    return (
      <Level1Card>
        <div className="flex items-center gap-2 mb-2">
          <CalendarDays className="w-5 h-5 text-[#717786]" />
          <h2
            className="text-[20px] font-bold text-[#717786]"
            style={{ fontFamily: "Inter, sans-serif", lineHeight: "26px" }}
          >
            vs Last Season
          </h2>
        </div>
        <p className="text-[15px] text-[#717786]" style={{ fontFamily: "Inter, sans-serif" }}>
          First season — comparison data will appear next year.
        </p>
      </Level1Card>
    );
  }

  const change = seasonComparison.percentChange;
  const isPositive = change >= 0;

  return (
    <Level1Card>
      <div className="flex items-center gap-2 mb-2">
        <CalendarDays className="w-5 h-5 text-[#0058bc]" />
        <h2
          className="text-[20px] font-bold text-[#1a1b1f]"
          style={{ fontFamily: "Inter, sans-serif", lineHeight: "26px" }}
        >
          vs Last Season
        </h2>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className="text-[28px] font-bold text-[#1a1b1f]"
          style={{ fontFamily: "Inter, sans-serif", lineHeight: "34px" }}
        >
          {seasonComparison.estimatedReach.toLocaleString()}
        </span>
        <span className="text-[14px] text-[#717786]" style={{ fontFamily: "Inter, sans-serif" }}>
          est. reach ({seasonComparison.period})
        </span>
      </div>
      <div className="flex items-center gap-1 mt-2">
        {isPositive ? (
          <TrendingUp className="w-4 h-4 text-[#247c54]" />
        ) : (
          <TrendingDown className="w-4 h-4 text-[#ba1a1a]" />
        )}
        <span
          className={`text-[15px] font-medium ${isPositive ? "text-[#247c54]" : "text-[#ba1a1a]"}`}
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          {isPositive ? "+" : ""}
          {change}%
        </span>
        <span className="text-[13px] text-[#717786]" style={{ fontFamily: "Inter, sans-serif" }}>
          vs same week last year
        </span>
      </div>
    </Level1Card>
  );
}

// ── Helper components ───────────────────────────────

function Level1Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mx-4 p-5 bg-white rounded-xl border border-[#E5E5E7]
                 shadow-[0px_4px_12px_rgba(0,0,0,0.05)]"
    >
      {children}
    </div>
  );
}


// ── Pre-Season Booking Intent Banner (Story 7.4, AC 4) ─────────

function PreSeasonBookingBanner({ clicks }: { clicks: number }) {
  return (
    <div className="mx-4 mb-1">
      <p
        className="text-[16px] text-[#0058bc]"
        style={{ fontFamily: "Inter, sans-serif", lineHeight: "21px" }}
      >
        🎯 {clicks.toLocaleString()} potential guest{clicks !== 1 ? "s" : ""} already planning {clicks !== 1 ? "their" : "a"} visit. Early booking campaigns are active.
      </p>
    </div>
  );
}

// ── Guardian Mode Banner (Story 7.3, AC 4) ───────────

function GuardianModeBanner({
  guardianMode,
}: {
  guardianMode: NonNullable<ResultsData["guardianMode"]>;
}) {
  return (
    <div className="mx-4 mb-1">
      <div
        className="flex items-center gap-2 px-4 py-3 rounded-lg
                   bg-[#E3F2FD] border border-[#BBDEFB]"
      >
        <Shield className="w-4 h-4 text-[#0058bc] flex-shrink-0" />
        <div className="flex flex-col gap-0.5">
          <p
            className="text-[14px] font-medium text-[#1a1b1f]"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            Off-Season Guardian Mode — {guardianMode.postsTarget} post{guardianMode.postsTarget > 1 ? "s" : ""}/week, review protection active
          </p>
          <p
            className="text-[12px] text-[#717786]"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            Litoral is keeping your Google presence alive while you&apos;re closed. You don&apos;t need to do anything.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Guardian Report Card (Story 7.3, AC 3) ────────────

function GuardianReportCard({
  report,
}: {
  report: NonNullable<ResultsData["guardianReport"]>;
}) {
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const monthNum = report.month % 100;
  const monthName = monthNames[monthNum - 1] ?? "";

  const stabilityIcon =
    report.rankingStability === "stable" ? (
      <ChevronUp className="w-4 h-4 text-[#247c54]" />
    ) : report.rankingStability === "slight_decline" ? (
      <ChevronDown className="w-4 h-4 text-[#F5A623]" />
    ) : (
      <ChevronDown className="w-4 h-4 text-[#ba1a1a]" />
    );

  const stabilityLabel =
    report.rankingStability === "stable"
      ? "Stable"
      : report.rankingStability === "slight_decline"
        ? "Slight decline"
        : "Significant decline";

  const stabilityColor =
    report.rankingStability === "stable"
      ? "text-[#247c54]"
      : report.rankingStability === "slight_decline"
        ? "text-[#F5A623]"
        : "text-[#ba1a1a]";

  return (
    <Level1Card>
      <div className="flex items-center gap-2 mb-3">
        <Shield className="w-5 h-5 text-[#0058bc]" />
        <h2
          className="text-[20px] font-bold text-[#1a1b1f]"
          style={{ fontFamily: "Inter, sans-serif", lineHeight: "26px" }}
        >
          Off-Season Guardian — {monthName} Report
        </h2>
      </div>

      <div className="flex flex-col gap-3">
        {/* Ranking stability */}
        <div className="flex items-center gap-2">
          <span className="text-[16px]" style={{ fontFamily: "Inter, sans-serif" }}>
            📊
          </span>
          <div className="flex items-center gap-1">
            {stabilityIcon}
            <span
              className={`text-[15px] font-medium ${stabilityColor}`}
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              Ranking: {stabilityLabel}
            </span>
          </div>
        </div>

        {/* Review coverage */}
        <div className="flex items-center gap-2">
          <span className="text-[16px]" style={{ fontFamily: "Inter, sans-serif" }}>
            📝
          </span>
          <span
            className="text-[15px] text-[#414755]"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            Review responses: {report.reviewCoverage.approved}/{report.reviewCoverage.total} approved
          </span>
        </div>

        {/* Decay avoided */}
        <div className="flex items-center gap-2">
          <span className="text-[16px]" style={{ fontFamily: "Inter, sans-serif" }}>
            📈
          </span>
          <span
            className="text-[15px] text-[#414755]"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            {report.decayAvoided}
          </span>
        </div>
      </div>

      <div
        className="mt-3 pt-3 border-t border-[#E5E5E7]"
      >
        <p
          className="text-[13px] text-[#717786]"
          style={{ fontFamily: "Inter, sans-serif", lineHeight: "18px" }}
        >
          Litoral is keeping your Google presence alive while you&apos;re closed.{report.postsPublished > 0 ? ` ${report.postsPublished} maintenance post${report.postsPublished !== 1 ? "s" : ""} published this month.` : ""}
        </p>
      </div>
    </Level1Card>
  );
}

// ── Skeleton loading card ────────────────────────────

function SkeletonCard() {
  return (
    <div className="mx-4 p-5 bg-white rounded-xl border border-[#E5E5E7] shadow-[0px_4px_12px_rgba(0,0,0,0.05)] animate-pulse">
      <div className="h-6 bg-[#E5E5E7] rounded w-1/3 mb-4"></div>
      <div className="h-8 bg-[#E5E5E7] rounded w-2/3 mb-2"></div>
      <div className="h-4 bg-[#E5E5E7] rounded w-1/2"></div>
    </div>
  );
}
