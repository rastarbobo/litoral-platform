CREATE TABLE `agent_config` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`agent_code` text(50) PRIMARY KEY NOT NULL,
	`provider` text(50) NOT NULL,
	`model` text(100) NOT NULL,
	`temperature` real NOT NULL,
	`max_tokens` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_config_provider_model_unique` ON `agent_config` (`provider`,`model`);--> statement-breakpoint
CREATE TABLE `environmental_signals` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY NOT NULL,
	`city_name` text(255) NOT NULL,
	`date` text(50) NOT NULL,
	`weather_data` text,
	`local_events` text,
	`trending_content` text
);
--> statement-breakpoint
CREATE INDEX `environmental_signals_city_date_idx` ON `environmental_signals` (`city_name`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `environmental_signals_city_date_unique` ON `environmental_signals` (`city_name`,`date`);--> statement-breakpoint
CREATE TABLE `prospect_events` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY NOT NULL,
	`prospect_id` text NOT NULL,
	`from_state` integer NOT NULL,
	`to_state` integer NOT NULL,
	`trigger` text NOT NULL,
	FOREIGN KEY (`prospect_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prospect_events_prospect_id_idx` ON `prospect_events` (`prospect_id`);--> statement-breakpoint
CREATE TABLE `restaurants` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY NOT NULL,
	`name` text(255) NOT NULL,
	`location` text(255),
	`google_place_id` text(255),
	`google_rating` real,
	`review_count` integer,
	`business_type` text(100),
	`qualification_status` text DEFAULT 'pending' NOT NULL,
	`exclusion_reason` text,
	`failed_rating_gate` integer DEFAULT false,
	`failed_reviews_gate` integer DEFAULT false,
	`failed_business_type_gate` integer DEFAULT false,
	`instagram_followers` integer,
	`instagram_engagement_rate_bps` integer,
	`google_maps_data` text,
	`competitor_data` text,
	`last_scraped_at` integer,
	`behavioral_state` integer DEFAULT 0 NOT NULL,
	`marketing_readiness_score` integer,
	`score_band` text(50),
	`primary_gap_explanation` text,
	`diagnostic_package` text,
	`enhanced_photo_url` text(1000)
);
--> statement-breakpoint
CREATE INDEX `restaurants_qualification_status_idx` ON `restaurants` (`qualification_status`);--> statement-breakpoint
CREATE INDEX `restaurants_name_idx` ON `restaurants` (`name`);--> statement-breakpoint
CREATE INDEX `restaurants_location_idx` ON `restaurants` (`location`);