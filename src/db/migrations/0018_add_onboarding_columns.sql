ALTER TABLE `restaurants` ADD `onboarding_state` text;--> statement-breakpoint
ALTER TABLE `restaurants` ADD `magic_link_token_hash` text(128);--> statement-breakpoint
ALTER TABLE `restaurants` ADD `magic_link_expires_at` integer;--> statement-breakpoint
ALTER TABLE `restaurants` ADD `onboarding_data_corrections` text;--> statement-breakpoint
CREATE INDEX `restaurants_magic_link_token_hash_idx` ON `restaurants` (`magic_link_token_hash`);