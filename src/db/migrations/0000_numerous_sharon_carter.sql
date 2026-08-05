CREATE TABLE `daily_stats` (
	`day` text PRIMARY KEY NOT NULL,
	`words` integer DEFAULT 0 NOT NULL,
	`sessions` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dictations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`raw_text` text NOT NULL,
	`final_text` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`words` integer NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`provider_id` text NOT NULL,
	`enhanced` integer DEFAULT false NOT NULL,
	`grammar_fixes` integer DEFAULT 0 NOT NULL,
	`dictionary_fixes` integer DEFAULT 0 NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dictations_created_idx` ON `dictations` (`created_at`);--> statement-breakpoint
CREATE INDEX `dictations_favorite_idx` ON `dictations` (`favorite`);--> statement-breakpoint
CREATE TABLE `dictionary` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_text` text NOT NULL,
	`to_text` text NOT NULL,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dictionary_from_text_unique` ON `dictionary` (`from_text`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
