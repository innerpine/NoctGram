CREATE TABLE `post_views` (
	`postId` text NOT NULL,
	`userId` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`postId`, `userId`),
	FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `star_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`sender` text,
	`recipient` text NOT NULL,
	`postId` text,
	`postText` text DEFAULT '' NOT NULL,
	`amount` integer NOT NULL,
	`kind` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`sender`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`postId`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `stars_sender` ON `star_transfers` (`sender`,`created`);--> statement-breakpoint
CREATE INDEX `stars_recipient` ON `star_transfers` (`recipient`,`created`);--> statement-breakpoint
CREATE INDEX `stars_post` ON `star_transfers` (`postId`,`sender`);--> statement-breakpoint
CREATE UNIQUE INDEX `stars_one_grant` ON `star_transfers` (`recipient`) WHERE "star_transfers"."kind" = 'grant';--> statement-breakpoint
ALTER TABLE `posts` ADD `code` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `posts` ADD `codeLang` text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE `posts` ADD `adult` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `kind` text DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `ownerId` text REFERENCES users(id);