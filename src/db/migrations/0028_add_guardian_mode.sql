-- Migration 0028: Guardian Mode (Story 7.3)
-- Adds operational_mode, guardian config, review_responses, and guardian_reports

-- 1. Add operational mode columns to restaurants
ALTER TABLE restaurants ADD COLUMN operational_mode TEXT NOT NULL DEFAULT 'peak_season';
ALTER TABLE restaurants ADD COLUMN mode_changed_at INTEGER;
ALTER TABLE restaurants ADD COLUMN peak_season_end_detected_at INTEGER;
ALTER TABLE restaurants ADD COLUMN guardian_mode_since INTEGER;
ALTER TABLE restaurants ADD COLUMN last_guardian_report_at INTEGER;
ALTER TABLE restaurants ADD COLUMN seo_guardian_config TEXT;

-- 2. Create review_responses table
CREATE TABLE review_responses (
    id TEXT PRIMARY KEY NOT NULL,
    restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    review_id TEXT NOT NULL,
    review_text TEXT NOT NULL,
    review_rating INTEGER NOT NULL,
    reviewer_name TEXT NOT NULL,
    ai_response TEXT,
    fallback_used INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'drafted' CHECK(status IN ('drafted', 'approved', 'rejected', 'published')),
    approved_at INTEGER,
    published_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE INDEX rr_restaurant_status_idx ON review_responses(restaurant_id, status);
CREATE INDEX rr_review_id_idx ON review_responses(review_id);

-- 3. Create guardian_reports table
CREATE TABLE guardian_reports (
    id TEXT PRIMARY KEY NOT NULL,
    restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    report_month INTEGER NOT NULL,
    ranking_stability TEXT NOT NULL CHECK(ranking_stability IN ('stable', 'slight_decline', 'significant_decline')),
    review_coverage TEXT NOT NULL,
    decay_avoided TEXT NOT NULL,
    posts_published INTEGER NOT NULL DEFAULT 0,
    generated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);

CREATE INDEX gr_restaurant_month_idx ON guardian_reports(restaurant_id, report_month);
CREATE UNIQUE INDEX gr_restaurant_month_unique ON guardian_reports(restaurant_id, report_month);

-- 4. Add indexes for operational mode queries
CREATE INDEX restaurants_operational_mode_idx ON restaurants(operational_mode);
CREATE INDEX restaurants_guardian_mode_since_idx ON restaurants(guardian_mode_since);