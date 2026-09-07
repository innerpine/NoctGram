CREATE TABLE `music_connections` (
	`userId` text NOT NULL,
	`provider` text NOT NULL,
	`id` text NOT NULL,
	`accountId` text NOT NULL,
	`displayName` text NOT NULL,
	`profileUrl` text NOT NULL,
	`sealedTokens` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`refreshLock` text DEFAULT '' NOT NULL,
	`refreshUntil` integer DEFAULT 0 NOT NULL,
	`updated` integer NOT NULL,
	PRIMARY KEY(`userId`, `provider`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `music_imports` (
	`userId` text NOT NULL,
	`provider` text NOT NULL,
	`playlistId` text NOT NULL,
	`connectionId` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`artwork` text DEFAULT '' NOT NULL,
	`trackCount` integer DEFAULT 0 NOT NULL,
	`playable` integer DEFAULT 0 NOT NULL,
	`imported` integer NOT NULL,
	PRIMARY KEY(`userId`, `provider`, `playlistId`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `music_oauth_states` (
	`stateHash` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`provider` text NOT NULL,
	`browserHash` text NOT NULL,
	`sealedVerifier` text NOT NULL,
	`consumed` integer DEFAULT 0 NOT NULL,
	`expiresAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `music_oauth_expiry` ON `music_oauth_states` (`expiresAt`);