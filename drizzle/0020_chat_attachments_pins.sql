CREATE TABLE `chat_uploads` (
	`uploadId` text PRIMARY KEY NOT NULL,
	`recipient` text NOT NULL,
	`size` integer NOT NULL,
	`kind` text NOT NULL,
	`messageId` text,
	FOREIGN KEY (`uploadId`) REFERENCES `uploads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`messageId`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `message_pins` (
	`messageId` text PRIMARY KEY NOT NULL,
	`firstId` text NOT NULL,
	`secondId` text NOT NULL,
	`pinnedBy` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`messageId`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`firstId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`secondId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pinnedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `message_pins_pair` ON `message_pins` (`firstId`,`secondId`,`created`);--> statement-breakpoint
ALTER TABLE `messages` ADD `media` text DEFAULT '[]' NOT NULL;