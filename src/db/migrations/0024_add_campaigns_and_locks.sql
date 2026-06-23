-- Migration 0024: Add generation_locks table for atomic locking + enhance campaigns with notification tracking
-- This resolves Review Findings Decision 1 (atomic lock) and Decision 3 (notification tracking)

-- ============================================
-- Decision 1: generation_locks table
-- Replaces KV-based generation_lock with D1-backed atomic locking.
-- The UNIQUE constraint on (restaurant_slug, lock_date) provides
-- true atomicity compared to Cloudflare KV PUT.
-- ============================================

CREATE TABLE IF NOT EXISTS generation_locks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '_' || lower(hex(randomblob(2))) || '_' || lower(hex(randomblob(2))) || '_' || lower(hex(randomblob(2))) || '_' || lower(hex(randomblob(6)))),
  restaurant_slug TEXT NOT NULL,
  lock_date TEXT NOT NULL,          -- YYYY-MM-DD format
  lock_until INTEGER NOT NULL,      -- Unix epoch seconds when lock expires
  restaurant_id TEXT REFERENCES restaurants(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'released')),
  created_at INTEGER DEFAULT (strftime('%s', 'now')) NOT NULL,

  -- TRUE ATOMICITY: unique per restaurant per day
  CONSTRAINT generation_locks_unique_per_restaurant_per_day UNIQUE (restaurant_slug, lock_date)
);

-- Fast lookups
CREATE INDEX generation_locks_restaurant_slug_idx ON generation_locks(restaurant_slug);
CREATE INDEX generation_locks_lock_date_idx ON generation_locks(lock_date);
CREATE INDEX generation_locks_lock_until_idx ON generation_locks(lock_until);

-- ============================================
-- Decision 2 & 3: Enhance campaigns table with state machine + notification tracking
-- ============================================

-- This migration assumes campaigns table already exists (created in 0023).
-- If not, it will be created by the earlier migration. We use ALTER TABLE here.

-- Notification status tracking (Decision 3)
ALTER TABLE campaigns
  ADD COLUMN notification_status TEXT DEFAULT 'pending' NOT NULL
    CHECK (notification_status IN ('pending', 'sent', 'failed', 'retrying'));

ALTER TABLE campaigns
  ADD COLUMN notification_attempts INTEGER DEFAULT 0 NOT NULL;

ALTER TABLE campaigns
  ADD COLUMN notification_last_error TEXT;

ALTER TABLE campaigns
  ADD COLUMN notification_sent_at INTEGER;

-- Create index for notification retry queries
CREATE INDEX campaigns_notification_status_idx ON campaigns(notification_status);

-- ============================================
-- Decision 4: Lock TTL to midnight calculation support
-- ============================================
-- No schema change needed; calculated in n8n workflow code.
-- TTL = midnight(of restaurant timezone) + 1 hour buffer in epoch seconds.
