CREATE TABLE `account_restrictions` (
	`userId` text PRIMARY KEY NOT NULL,
	`eventId` text NOT NULL,
	`mode` text NOT NULL,
	`reason` text NOT NULL,
	`expiresAt` integer,
	`created` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`eventId`) REFERENCES `moderation_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `moderation_appeals` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`eventId` text NOT NULL,
	`text` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created` integer NOT NULL,
	`reviewedBy` text,
	`reviewedAt` integer,
	`reviewNote` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`eventId`) REFERENCES `moderation_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appeal_event` ON `moderation_appeals` (`eventId`);--> statement-breakpoint
CREATE INDEX `appeals_status` ON `moderation_appeals` (`status`,`created`);--> statement-breakpoint
CREATE TABLE `moderation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`moderatorId` text NOT NULL,
	`mode` text NOT NULL,
	`reason` text NOT NULL,
	`expiresAt` integer,
	`created` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`moderatorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `moderation_events_user` ON `moderation_events` (`userId`,`created`);--> statement-breakpoint
CREATE TABLE `moderators` (
	`userId` text PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
