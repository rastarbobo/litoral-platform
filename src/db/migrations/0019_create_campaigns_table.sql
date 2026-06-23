-- Migration: Create campaigns table baseline (fills missing CREATE TABLE in migration chain)
-- The campaigns table was defined in Drizzle schema but never created via .sql migration.
-- This migration creates it before any .sql file references it via ALTER TABLE or INSERT.

CREATE TABLE IF NOT EXISTS campaigns (
  createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updatedAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updateCounter INTEGER DEFAULT 0,
  id TEXT PRIMARY KEY NOT NULL,
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  owner_input_type TEXT,
  campaign_type TEXT NOT NULL,
  headline TEXT,
  subheadline TEXT,
  why_now_context TEXT,
  asset_url TEXT,
  asset_r2_key TEXT(500),
  full_asset_r2_key TEXT(500),
  caption TEXT,
  platforms TEXT,
  signal_trigger TEXT,
  signals_trigger_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending_approval',
  telegram_message_id INTEGER,
  revision_count INTEGER NOT NULL DEFAULT 0,
  nudge_count INTEGER NOT NULL DEFAULT 0,
  last_nudge_at INTEGER,
  approved_at INTEGER,
  rejected_at INTEGER,
  claimed_at INTEGER,
  scheduled_at INTEGER,
  claimed_by TEXT(255),
  revert_count INTEGER NOT NULL DEFAULT 0,
  last_run_at INTEGER,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS campaigns_restaurant_id_idx ON campaigns (restaurant_id);
CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns (status);
CREATE INDEX IF NOT EXISTS campaigns_source_idx ON campaigns (source);
CREATE INDEX IF NOT EXISTS campaigns_created_at_idx ON campaigns (createdAt);
CREATE INDEX IF NOT EXISTS campaigns_status_claimed_scheduled_idx ON campaigns (status, claimed_at, scheduled_at);