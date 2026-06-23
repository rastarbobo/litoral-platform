-- Migration: Add Brand Persona columns to restaurants table (Story 3.2)
-- R2 + D1 hybrid storage: full doc in R2, fragment (≤500 tokens) in D1

ALTER TABLE restaurants ADD COLUMN brand_persona_fragment TEXT;
ALTER TABLE restaurants ADD COLUMN brand_persona_r2_key TEXT;