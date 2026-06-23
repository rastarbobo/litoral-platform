-- Migration: Add subscription_status column to restaurants table (Story 3.3)
-- Enables One Per Town scarcity enforcement (max 2 SaaS + 1 Agency per cuisine/area)

ALTER TABLE restaurants ADD COLUMN subscription_status TEXT DEFAULT 'prospect' NOT NULL;
CREATE INDEX IF NOT EXISTS restaurants_scarcity_idx ON restaurants (cuisine_type, location_area, subscription_status);