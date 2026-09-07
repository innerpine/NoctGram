CREATE TABLE `telegram_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`tokenHash` text NOT NULL,
	`telegramId` text,
	`telegramName` text,
	`telegramUsername` text,
	`codeHash` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_challenges_userId_unique` ON `telegram_challenges` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_challenges_tokenHash_unique` ON `telegram_challenges` (`tokenHash`);--> statement-breakpoint
CREATE TABLE `telegram_links` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`telegramId` text NOT NULL,
	`telegramName` text NOT NULL,
	`telegramUsername` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_links_userId_unique` ON `telegram_links` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_links_telegramId_unique` ON `telegram_links` (`telegramId`);--> statement-breakpoint
CREATE TABLE `telegram_topups` (
	`id` text PRIMARY KEY NOT NULL,
	`requestKey` text NOT NULL,
	`userId` text NOT NULL,
	`telegramId` text NOT NULL,
	`linkId` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`creditedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_topups_requestKey_unique` ON `telegram_topups` (`requestKey`);--> statement-breakpoint
CREATE INDEX `telegram_topups_user` ON `telegram_topups` (`userId`,`created`);--> statement-breakpoint
CREATE INDEX `telegram_topups_sender` ON `telegram_topups` (`telegramId`,`created`);