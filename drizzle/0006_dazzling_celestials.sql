CREATE TABLE `user_blocks` (
	`blocker` text NOT NULL,
	`blocked` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`blocker`, `blocked`),
	FOREIGN KEY (`blocker`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocked`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_blocks_reverse` ON `user_blocks` (`blocked`,`blocker`);--> statement-breakpoint
CREATE TABLE `user_privacy` (
	`userId` text PRIMARY KEY NOT NULL,
	`hideAdult` integer DEFAULT 0 NOT NULL,
	`messagePolicy` text DEFAULT 'everyone' NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
