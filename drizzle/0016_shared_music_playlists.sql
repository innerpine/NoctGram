CREATE TABLE `music_playlist_members` (
	`playlistId` text NOT NULL,
	`userId` text NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`created` integer NOT NULL,
	`listenSession` text DEFAULT '' NOT NULL,
	`listenUntil` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`playlistId`, `userId`),
	FOREIGN KEY (`playlistId`) REFERENCES `music_playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `music_playlist_members_user` ON `music_playlist_members` (`userId`);--> statement-breakpoint
CREATE TABLE `music_playlist_tracks` (
	`playlistId` text NOT NULL,
	`trackId` text NOT NULL,
	`addedBy` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`playlistId`, `trackId`),
	FOREIGN KEY (`playlistId`) REFERENCES `music_playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trackId`) REFERENCES `music_tracks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`addedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `music_playlist_tracks_order` ON `music_playlist_tracks` (`playlistId`,`created`);--> statement-breakpoint
CREATE TABLE `music_playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`name` text NOT NULL,
	`created` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`trackId` text,
	`playing` integer DEFAULT 0 NOT NULL,
	`positionMs` integer DEFAULT 0 NOT NULL,
	`durationMs` integer DEFAULT 0 NOT NULL,
	`playbackAt` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trackId`) REFERENCES `music_tracks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `music_playlists_owner` ON `music_playlists` (`ownerId`);