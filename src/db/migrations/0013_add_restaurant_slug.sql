ALTER TABLE `restaurants` ADD `slug` text(255);--> statement-breakpoint
CREATE UNIQUE INDEX `restaurants_slug_unique` ON `restaurants` (`slug`);--> statement-breakpoint
CREATE INDEX `restaurants_slug_idx` ON `restaurants` (`slug`);