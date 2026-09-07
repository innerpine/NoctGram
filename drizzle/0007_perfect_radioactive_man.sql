CREATE TABLE `music_library` (
	`userId` text NOT NULL,
	`trackId` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`userId`, `trackId`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trackId`) REFERENCES `music_tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `music_library_track` ON `music_library` (`trackId`);--> statement-breakpoint
CREATE TABLE `music_listens` (
	`userId` text NOT NULL,
	`trackId` text NOT NULL,
	`day` integer NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`userId`, `trackId`, `day`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trackId`) REFERENCES `music_tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `music_listens_recent` ON `music_listens` (`created`,`trackId`);--> statement-breakpoint
CREATE TABLE `music_preferences` (
	`userId` text PRIMARY KEY NOT NULL,
	`participate` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `music_sessions` (
	`userId` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`trackId` text NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`totalMs` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trackId`) REFERENCES `music_tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_sessions_id_unique` ON `music_sessions` (`id`);--> statement-breakpoint
CREATE TABLE `music_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`kind` text NOT NULL,
	`provider` text DEFAULT 'soundcloud' NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`artwork` text DEFAULT '' NOT NULL,
	`authorUrl` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_tracks_url_unique` ON `music_tracks` (`url`);