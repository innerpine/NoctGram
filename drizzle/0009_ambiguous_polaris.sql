CREATE TABLE `music_audio` (
	`userId` text NOT NULL,
	`trackId` text NOT NULL,
	`objectKey` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`userId`, `trackId`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trackId`) REFERENCES `music_tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_audio_objectKey_unique` ON `music_audio` (`objectKey`);--> statement-breakpoint
ALTER TABLE `music_tracks` ADD `durationMs` integer DEFAULT 0 NOT NULL;