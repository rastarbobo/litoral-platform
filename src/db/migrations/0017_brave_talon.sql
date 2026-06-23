CREATE TABLE `analytics_events` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY NOT NULL,
	`prospect_id` text,
	`event_type` text NOT NULL,
	`metadata` text,
	FOREIGN KEY (`prospect_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `analytics_events_prospect_id_idx` ON `analytics_events` (`prospect_id`);--> statement-breakpoint
CREATE INDEX `analytics_events_event_type_idx` ON `analytics_events` (`event_type`);--> statement-breakpoint
CREATE INDEX `analytics_events_created_at_idx` ON `analytics_events` (`createdAt`);