ALTER TABLE `bookmark` ADD `visibility` text DEFAULT 'public' NOT NULL;--> statement-breakpoint
CREATE INDEX `bookmark_visibility_idx` ON `bookmark` (`visibility`);