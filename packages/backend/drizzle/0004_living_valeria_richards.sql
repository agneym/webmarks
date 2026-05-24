ALTER TABLE `bookmark` ADD `user_id` text NOT NULL REFERENCES user(id);--> statement-breakpoint
CREATE INDEX `bookmark_userId_idx` ON `bookmark` (`user_id`);