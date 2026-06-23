-- Migration 0029: Catch-up for tables and columns in Drizzle schema but missing SQL migrations
-- These exist in Drizzle schema (and meta snapshots) but never received their own CREATE/ALTER SQL,
-- causing D1 test environment failures.

-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN, so we rely on
-- migration ordering to ensure this only runs once (applied as migration 0029).

-- ── Restaurant Columns ───────────────────────────────────────

-- 1. Extension auth token (Story 5.6: n8n Extension Auth Provisioning)
ALTER TABLE restaurants ADD COLUMN extension_auth_token TEXT;
CREATE INDEX IF NOT EXISTS restaurants_extension_auth_token_idx ON restaurants(extension_auth_token);

-- 2. Hibernate columns (Story 7.5)
ALTER TABLE restaurants ADD COLUMN hibernate_since INTEGER;
ALTER TABLE restaurants ADD COLUMN reactivation_eligibility TEXT;

-- 3. Pre-season booking toggle (Story 7.4)
ALTER TABLE restaurants ADD COLUMN pre_season_booking_enabled INTEGER NOT NULL DEFAULT 0;

-- 4. Extension monitoring alerts (Story 6.5)
ALTER TABLE restaurants ADD COLUMN last_offline_alert_at INTEGER;
ALTER TABLE restaurants ADD COLUMN last_operator_alert_at INTEGER;

-- ── Tables ───────────────────────────────────────────────────

-- 5. Campaign Analytics — weekly aggregate of published campaign performance (Story 7.1)
CREATE TABLE campaign_analytics (
    id TEXT PRIMARY KEY NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    updateCounter INTEGER DEFAULT 0,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK(platform IN ('instagram', 'facebook', 'tiktok', 'gbp')),
    impressions INTEGER NOT NULL DEFAULT 0,
    engagement_rate_bps INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    conversions INTEGER NOT NULL DEFAULT 0,
    early_booking_intent_clicks INTEGER NOT NULL DEFAULT 0,
    week_start INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ca_restaurant_week_idx ON campaign_analytics(restaurant_id, week_start);
CREATE INDEX IF NOT EXISTS ca_campaign_id_idx ON campaign_analytics(campaign_id);

-- 6. Restaurant Metrics — per-restaurant configurable constants for ROI calculation (Story 7.1)
CREATE TABLE restaurant_metrics (
    restaurant_id TEXT PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
    local_conversion_rate REAL NOT NULL DEFAULT 0.02,
    avg_revenue_per_table REAL NOT NULL DEFAULT 50,
    avg_table_size REAL NOT NULL DEFAULT 2.5,
    last_updated_at INTEGER NOT NULL
);