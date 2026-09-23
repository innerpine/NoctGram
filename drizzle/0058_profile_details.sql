CREATE TABLE `profile_channels` (
	`userId` text NOT NULL,
	`channelId` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`userId`, `channelId`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channelId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_channels_channel` ON `profile_channels` (`channelId`);--> statement-breakpoint
CREATE TABLE `profile_details` (
	`userId` text PRIMARY KEY NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`instagram` text DEFAULT '' NOT NULL,
	`tiktok` text DEFAULT '' NOT NULL,
	`youtube` text DEFAULT '' NOT NULL,
	`birthday` text DEFAULT '' NOT NULL,
	`showBirthYear` integer DEFAULT 1 NOT NULL,
	`updated` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
