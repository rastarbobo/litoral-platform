-- Migration: Add Stripe subscription columns to restaurants table (Story 3.4)
-- Enables Stripe checkout session correlation, subscription tier tracking, and billing management

ALTER TABLE restaurants ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE restaurants ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE restaurants ADD COLUMN subscription_tier TEXT CHECK (subscription_tier IN ('starter', 'pro', 'annual_pro'));
ALTER TABLE restaurants ADD COLUMN subscription_current_period_end INTEGER;