CREATE TABLE `hidden_posts` (
	`postId` text NOT NULL,
	`userId` text NOT NULL,
	PRIMARY KEY(`postId`, `userId`),
	FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`postId` text NOT NULL,
	`userId` text NOT NULL,
	`reason` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`postId`, `userId`),
	FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `posts` ADD `pinned` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `lastSeen` integer DEFAULT 0 NOT NULL;