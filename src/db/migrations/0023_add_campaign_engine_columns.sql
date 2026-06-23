-- Migration 0023: Campaign Engine (Epic 4) columns
-- Adds campaign_pending JSON column, last_run_at timestamp, campaign_cron_offset_minutes, and telegram_chat_id
-- to the restaurants table for the Daily Campaign Generation workflow.

ALTER TABLE restaurants ADD COLUMN campaign_pending TEXT;
ALTER TABLE restaurants ADD COLUMN last_run_at INTEGER;
ALTER TABLE restaurants ADD COLUMN campaign_cron_offset_minutes INTEGER DEFAULT 0;
ALTER TABLE restaurants ADD COLUMN telegram_chat_id TEXT;

-- Index for campaign cron scheduling queries
CREATE INDEX IF NOT EXISTS restaurants_last_run_at_idx ON restaurants(last_run_at);
CREATE INDEX IF NOT EXISTS restaurants_campaign_cron_offset_idx ON restaurants(campaign_cron_offset_minutes);