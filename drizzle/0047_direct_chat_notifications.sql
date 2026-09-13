CREATE TABLE `direct_chat_notifications` (
	`userId` text NOT NULL,
	`peerId` text NOT NULL,
	`muted` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`userId`, `peerId`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`peerId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "direct_chat_notifications_muted" CHECK("direct_chat_notifications"."muted" IN (0,1)),
	CONSTRAINT "direct_chat_notifications_peer" CHECK("direct_chat_notifications"."userId"<>"direct_chat_notifications"."peerId")
);
