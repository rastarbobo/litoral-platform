-- Migration: Add campaign_revisions table for Telegram Conversational Revisions (Story 5.2)
-- Stores audit trail of every caption revision made via Telegram conversation

CREATE TABLE `campaign_revisions` (
    `createdAt` integer NOT NULL,
    `updatedAt` integer NOT NULL,
    `updateCounter` integer DEFAULT 0,
    `id` text PRIMARY KEY NOT NULL,
    `campaign_id` text NOT NULL,
    `revision_number` integer NOT NULL,
    `original_caption` text,
    `revised_caption` text,
    `instructions` text,
    `ai_response` text CHECK (json_valid(`ai_response`)),
    `status_before` text NOT NULL,
    `status_after` text NOT NULL,
    FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `campaign_revisions_campaign_id_idx` ON `campaign_revisions` (`campaign_id`);
CREATE INDEX `campaign_revisions_revision_number_idx` ON `campaign_revisions` (`campaign_id`, `revision_number`);
