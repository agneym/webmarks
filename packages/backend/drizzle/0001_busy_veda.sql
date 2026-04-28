CREATE TABLE `bookmark` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
