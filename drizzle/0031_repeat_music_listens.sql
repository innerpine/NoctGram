ALTER TABLE `music_listens` ADD `plays` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `music_sessions` ADD `counted` integer DEFAULT 0 NOT NULL;