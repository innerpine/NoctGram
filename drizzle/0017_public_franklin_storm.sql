CREATE TABLE `channel_boost_slots` (
	`userId` text NOT NULL,
	`slot` integer NOT NULL,
	`channelId` text,
	`changedAt` integer NOT NULL,
	`availableAt` integer NOT NULL,
	PRIMARY KEY(`userId`, `slot`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channelId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "boost_slot_range" CHECK("channel_boost_slots"."slot" IN (1,2,3,4))
);
--> statement-breakpoint
CREATE INDEX `boost_slots_channel` ON `channel_boost_slots` (`channelId`,`userId`);