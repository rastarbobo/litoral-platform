-- Migration: Add template_forge table for Template Forge integration (Story 4.4)
-- Stores per-restaurant template performance data and AI-proposed template variations

CREATE TABLE `template_forge` (
    `createdAt` integer NOT NULL,
    `updatedAt` integer NOT NULL,
    `updateCounter` integer DEFAULT 0,
    `id` text PRIMARY KEY NOT NULL,
    `restaurant_id` text,
    `template_id` text(255) NOT NULL,
    `campaign_type` text NOT NULL,
    `impressions` integer DEFAULT 0 NOT NULL,
    `engagement_rate_bps` integer DEFAULT 0 NOT NULL,
    `ctr_bps` integer DEFAULT 0 NOT NULL,
    `conversions` integer DEFAULT 0 NOT NULL,
    `performance_score` real DEFAULT 0 NOT NULL,
    `last_selected_at` integer,
    `status` text DEFAULT 'active' NOT NULL,
    `proposed_at` integer,
    `parent_template_id` text(255),
    `ncat_parameters_diff` text CHECK (json_valid(`ncat_parameters_diff`)),
    `performance_hypothesis` text,
    `schema_version` text(10) DEFAULT '1.0' NOT NULL,
    `deprecated_at` integer,
    FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX `template_forge_restaurant_campaign_status_idx` ON `template_forge` (`restaurant_id`,`campaign_type`,`status`);
CREATE INDEX `template_forge_template_id_idx` ON `template_forge` (`template_id`);
CREATE INDEX `template_forge_performance_score_idx` ON `template_forge` (`performance_score`);
CREATE INDEX `template_forge_last_selected_at_idx` ON `template_forge` (`last_selected_at`);
CREATE INDEX `template_forge_status_proposed_at_idx` ON `template_forge` (`status`,`proposed_at`);
CREATE UNIQUE INDEX `template_forge_restaurant_template_campaign_unique` ON `template_forge` (`restaurant_id`,`template_id`,`campaign_type`);
