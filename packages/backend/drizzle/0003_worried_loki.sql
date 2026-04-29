ALTER TABLE `bookmark` ADD `title` text;--> statement-breakpoint
ALTER TABLE `bookmark` ADD `description` text;--> statement-breakpoint
ALTER TABLE `bookmark` ADD `image` text;--> statement-breakpoint
ALTER TABLE `bookmark` ADD `favicon` text;--> statement-breakpoint
ALTER TABLE `bookmark` ADD `fetch_status` text DEFAULT 'pending' NOT NULL;