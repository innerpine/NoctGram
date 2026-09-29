CREATE TABLE `chat_room_topic_reads` (
	`roomId` text NOT NULL,
	`topicId` text NOT NULL,
	`userId` text NOT NULL,
	`lastReadAt` integer DEFAULT 0 NOT NULL,
	`lastReadId` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`roomId`, `topicId`, `userId`),
	FOREIGN KEY (`roomId`) REFERENCES `chat_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `chat_room_topics` (
	`id` text PRIMARY KEY NOT NULL,
	`roomId` text NOT NULL,
	`title` text NOT NULL,
	`color` integer DEFAULT 0 NOT NULL,
	`emoji` text DEFAULT '' NOT NULL,
	`createdBy` text NOT NULL,
	`created` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`closedAt` integer DEFAULT 0 NOT NULL,
	`deletedAt` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`roomId`) REFERENCES `chat_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chat_room_topics_color" CHECK("chat_room_topics"."color" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE INDEX `chat_room_topics_room` ON `chat_room_topics` (`roomId`,`deletedAt`,`updatedAt`);--> statement-breakpoint
ALTER TABLE `chat_room_messages` ADD `topicId` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_room_messages` ADD `threadRootId` text;--> statement-breakpoint
CREATE INDEX `chat_room_messages_topic` ON `chat_room_messages` (`roomId`,`topicId`,`created`,`id`);--> statement-breakpoint
CREATE INDEX `chat_room_messages_thread` ON `chat_room_messages` (`roomId`,`threadRootId`,`created`,`id`);--> statement-breakpoint
ALTER TABLE `chat_rooms` ADD `forum` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `chat_room_messages` SET `threadRootId`=`replyTo` WHERE `replyTo` IS NOT NULL AND `ciphertext` IS NULL;--> statement-breakpoint
UPDATE `chat_room_messages` SET `threadRootId`=(SELECT p.`threadRootId` FROM `chat_room_messages` p WHERE p.`id`=`chat_room_messages`.`threadRootId`) WHERE EXISTS(SELECT 1 FROM `chat_room_messages` p WHERE p.`id`=`chat_room_messages`.`threadRootId` AND p.`threadRootId` IS NOT NULL);--> statement-breakpoint
UPDATE `chat_room_messages` SET `threadRootId`=(SELECT p.`threadRootId` FROM `chat_room_messages` p WHERE p.`id`=`chat_room_messages`.`threadRootId`) WHERE EXISTS(SELECT 1 FROM `chat_room_messages` p WHERE p.`id`=`chat_room_messages`.`threadRootId` AND p.`threadRootId` IS NOT NULL);--> statement-breakpoint
UPDATE `chat_room_messages` SET `threadRootId`=(SELECT p.`threadRootId` FROM `chat_room_messages` p WHERE p.`id`=`chat_room_messages`.`threadRootId`) WHERE EXISTS(SELECT 1 FROM `chat_room_messages` p WHERE p.`id`=`chat_room_messages`.`threadRootId` AND p.`threadRootId` IS NOT NULL);--> statement-breakpoint
UPDATE `chat_room_messages` SET `threadRootId`=(SELECT p.`threadRootId` FROM `chat_room_messages` p WHERE p.`id`=`chat_room_messages`.`threadRootId`) WHERE EXISTS(SELECT 1 FROM `chat_room_messages` p WHERE p.`id`=`chat_room_messages`.`threadRootId` AND p.`threadRootId` IS NOT NULL);--> statement-breakpoint
UPDATE `chat_room_messages` SET `threadRootId`=(SELECT p.`threadRootId` FROM `chat_room_messages` p WHERE p.`id`=`chat_room_messages`.`threadRootId`) WHERE EXISTS(SELECT 1 FROM `chat_room_messages` p WHERE p.`id`=`chat_room_messages`.`threadRootId` AND p.`threadRootId` IS NOT NULL);
