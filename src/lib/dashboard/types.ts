/**
 * Dashboard-specific type definitions.
 *
 * These types are used across the mobile-first dashboard surface.
 * They mirror the JSend API contracts and the Drizzle schema types
 * for safe client/server interchange.
 */

import type { Campaign } from "@/db/schema";

// ── Campaign Queue ───────────────────────────────────────

export interface CampaignGroup {
  pending: CampaignWithSignedUrl[];
  scheduled: CampaignWithSignedUrl[];
  published: CampaignWithSignedUrl[];
  rejected: CampaignWithSignedUrl[];
}

export interface CampaignWithSignedUrl extends Campaign {
  thumbnailUrl: string | null; // 7-day R2 signed URL
}

// ── Results View ─────────────────────────────────────────

export interface WeeklyResult {
  estimatedReach: number;
  percentChange: number;
  period: string; // e.g. "Mon–Sun, 17 Jun"
}

export interface OneExtraTable {
  text: string; // e.g. "Estimated 1.4 extra tables this week"
}

export interface AnalystInsight {
  quote: string;
  source: "analyst" | "operator";
}

export interface ResultsData {
  thisWeek: WeeklyResult;
  oneExtraTable: OneExtraTable;
  analystInsight: AnalystInsight;
  seasonComparison?: WeeklyResult | null; // Story 7.1: same week last year

  // Guarding Mode (Story 7.3)
  guardianMode?: {
    enabled: boolean;
    mode: "peak_season" | "local_seo_guardian" | "pre_season_booking" | "hibernate";
    since: string | null; // ISO date
    postsThisWeek: number;
    postsTarget: number; // 1 or 2
  } | null;
  guardianReport?: GuardianReportData | null;

  // Pre-Season Booking Engine (Story 7.4)
  preSeasonBooking?: {
    clicks: number;
  };
}

export interface GuardianReportData {
  month: number; // YYYYMM
  rankingStability: "stable" | "slight_decline" | "significant_decline";
  reviewCoverage: {
    drafted: number;
    approved: number;
    published: number;
    total: number;
  };
  decayAvoided: string;
  postsPublished: number;
}

// ── Dashboard API Response ───────────────────────────────

export interface JSendSuccess<T = unknown> {
  status: "success";
  data: T;
}

export interface JSendError {
  status: "error";
  message: string;
}

export type JSendResponse<T = unknown> = JSendSuccess<T> | JSendError;

// ── Dashboard Store ────────────────────────────────────

export type DashboardTab = "queue" | "results" | "settings";

export interface DashboardState {
  activeTab: DashboardTab;
  restaurantId: string | null;
  token: string | null;
  campaigns: CampaignGroup;
  results: ResultsData | null;
  isLoading: boolean;
  error: string | null;
}

// ── Auth Guard ───────────────────────────────────────────

export interface DashboardSession {
  restaurantId: string;
  token: string;
  expiresAt: Date | null;
}

// ── Campaign Actions ─────────────────────────────────────

export type CampaignAction = "approve" | "reject" | "request_revision";

export interface CampaignActionRequest {
  campaignId: string;
  action: CampaignAction;
  revisionInstructions?: string;
  rejectReason?: string;
}

export interface CampaignActionResponse {
  campaign: {
    id: string;
    status: string;
    approvedAt: string | null;
    rejectedAt: string | null;
  };
}

// ── Filter & Sort ────────────────────────────────────────

export type SortOption = "created_at_desc" | "created_at_asc";

export type CampaignTypeFilter = "flash_offer" | "seasonal_event" | "daily_special" | "brand_awareness" | "pre_season_booking" | "guardian" | "all";

export type SourceFilter = "autonomous" | "owner_initiated" | "all";

export interface FilterState {
  sort: SortOption;
  campaignType: CampaignTypeFilter;
  source: SourceFilter;
}
