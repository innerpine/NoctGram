CREATE TABLE `music_activity` (
	`userId` text PRIMARY KEY NOT NULL,
	`sessionId` text NOT NULL,
	`sequence` integer NOT NULL,
	`trackUrl` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`artist` text DEFAULT '' NOT NULL,
	`artwork` text DEFAULT '' NOT NULL,
	`provider` text DEFAULT 'soundcloud' NOT NULL,
	`positionMs` integer DEFAULT 0 NOT NULL,
	`durationMs` integer DEFAULT 0 NOT NULL,
	`updatedAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `user_privacy` ADD `showMusicActivity` integer DEFAULT 1 NOT NULL;