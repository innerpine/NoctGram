CREATE TABLE `hidden_messages` (
	`messageId` text NOT NULL,
	`userId` text NOT NULL,
	PRIMARY KEY(`messageId`, `userId`),
	FOREIGN KEY (`messageId`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `replyTo` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `forwardedName` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `forwardSourceId` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `editedAt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `deletedAt` integer DEFAULT 0 NOT NULL;