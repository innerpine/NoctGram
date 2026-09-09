CREATE TABLE `music_app_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`sealedTokens` text DEFAULT '' NOT NULL,
	`expiresAt` integer DEFAULT 0 NOT NULL,
	`lease` text DEFAULT '' NOT NULL,
	`leaseUntil` integer DEFAULT 0 NOT NULL,
	`retryAt` integer DEFAULT 0 NOT NULL
);
