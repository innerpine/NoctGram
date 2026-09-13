CREATE TABLE `chat_room_message_reactions` (
	`messageId` text NOT NULL,
	`userId` text NOT NULL,
	`emoji` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`messageId`, `userId`),
	FOREIGN KEY (`messageId`) REFERENCES `chat_room_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chat_room_message_reactions_emoji" CHECK("chat_room_message_reactions"."emoji" IN ('👍','❤️','😂','🔥','🎉','🤯','😢','👎'))
);
--> statement-breakpoint
CREATE INDEX `chat_room_message_reactions_user` ON `chat_room_message_reactions` (`userId`);--> statement-breakpoint
CREATE TABLE `message_reactions` (
	`messageId` text NOT NULL,
	`userId` text NOT NULL,
	`emoji` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`messageId`, `userId`),
	FOREIGN KEY (`messageId`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "message_reactions_emoji" CHECK("message_reactions"."emoji" IN ('👍','❤️','😂','🔥','🎉','🤯','😢','👎'))
);
--> statement-breakpoint
CREATE INDEX `message_reactions_user` ON `message_reactions` (`userId`);