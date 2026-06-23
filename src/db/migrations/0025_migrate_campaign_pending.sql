-- Migration 0025: Migrate existing inline campaign data to campaigns table
-- This resolves Review Finding Decision 2: inline storage → separate table

-- ============================================
-- Migrate existing restaurants.campaign_pending → campaigns table
-- ============================================

-- Insert campaign_pending data into campaigns table as new records
INSERT INTO campaigns (
  restaurant_id,
  source,
  campaign_type,
  asset_url,
  caption,
  signals_trigger_hash,
  status,
  notification_status,
  notification_attempts,
  last_run_at,
  created_at,
  updated_at
)
SELECT
  id AS restaurant_id,
  'autonomous' AS source,
  COALESCE(json_extract(campaign_pending, '$.campaign_type'), 'brand_awareness') AS campaign_type,
  json_extract(campaign_pending, '$.asset_url') AS asset_url,
  json_extract(campaign_pending, '$.caption') AS caption,
  json_extract(campaign_pending, '$.signals_trigger_hash') AS signals_trigger_hash,
  COALESCE(json_extract(campaign_pending, '$.status'), 'pending_approval') AS status,
  COALESCE(json_extract(campaign_pending, '$.notification_status'), 'pending') AS notification_status,
  COALESCE(json_extract(campaign_pending, '$.notification_attempts'), 0) AS notification_attempts,
  last_run_at,
  COALESCE(json_extract(campaign_pending, '$.created_at'), strftime('%s', 'now')) AS created_at,
  COALESCE(json_extract(campaign_pending, '$.updated_at'), strftime('%s', 'now')) AS updated_at
FROM restaurants
WHERE campaign_pending IS NOT NULL
  AND json_extract(campaign_pending, '$.status') IN ('pending_approval', 'approved', 'scheduled')
  AND last_run_at IS NOT NULL
  -- Only migrate if no existing campaign record exists for this restaurant with matching creation date
  AND NOT EXISTS (
    SELECT 1 FROM campaigns c
    WHERE c.restaurant_id = restaurants.id
      AND c.source = 'autonomous'
      AND c.created_at = COALESCE(json_extract(restaurants.campaign_pending, '$.created_at'), 0)
  );

-- Remove inline campaign data from restaurants after migration (idempotent: only if no pending campaigns remain inline)
UPDATE restaurants
SET campaign_pending = NULL
WHERE campaign_pending IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM campaigns c
    WHERE c.restaurant_id = restaurants.id
      AND c.status = 'pending_approval'
  );

-- ============================================
-- Post-migration cleanup verification
-- ============================================

-- Count migrated campaigns
SELECT 'Migrated campaigns' AS report, COUNT(*) AS count FROM campaigns WHERE source = 'autonomous';

-- Count remaining inline campaign data
SELECT 'Remaining inline campaigns' AS report, COUNT(*) AS count FROM restaurants WHERE campaign_pending IS NOT NULL;
