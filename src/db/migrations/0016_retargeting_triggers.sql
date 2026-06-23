ALTER TABLE `restaurants` ADD `cuisine_type` text(100) DEFAULT '';--> statement-breakpoint
ALTER TABLE `restaurants` ADD `location_area` text(255) DEFAULT '';--> statement-breakpoint
ALTER TABLE `restaurants` ADD `peak_season_start` text(10);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `restaurants_cuisine_location_idx` ON `restaurants` (`cuisine_type`,`location_area`);