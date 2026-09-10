CREATE TABLE `chat_room_invites` (
	`roomId` text PRIMARY KEY NOT NULL,
	`tokenHash` text NOT NULL,
	`createdBy` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`roomId`) REFERENCES `chat_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_room_invites_tokenHash_unique` ON `chat_room_invites` (`tokenHash`);--> statement-breakpoint
CREATE TABLE `chat_room_members` (
	`roomId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`publicKey` text DEFAULT '' NOT NULL,
	`joinedAt` integer NOT NULL,
	`lastReadAt` integer DEFAULT 0 NOT NULL,
	`lastReadId` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`roomId`, `userId`),
	FOREIGN KEY (`roomId`) REFERENCES `chat_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chat_room_members_role" CHECK("chat_room_members"."role" IN ('owner','admin','member')),
	CONSTRAINT "chat_room_members_status" CHECK("chat_room_members"."status" IN ('active','left','banned'))
);
--> statement-breakpoint
CREATE INDEX `chat_room_members_user` ON `chat_room_members` (`userId`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_room_one_owner` ON `chat_room_members` (`roomId`) WHERE "chat_room_members"."role" = 'owner' AND "chat_room_members"."status" = 'active';--> statement-breakpoint
CREATE TABLE `chat_room_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`roomId` text NOT NULL,
	`sender` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`ciphertext` text,
	`replyTo` text,
	`created` integer NOT NULL,
	`deletedAt` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`roomId`) REFERENCES `chat_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chat_room_message_payload" CHECK("chat_room_messages"."ciphertext" IS NULL OR ("chat_room_messages"."text" = '' AND "chat_room_messages"."replyTo" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `chat_room_messages_room` ON `chat_room_messages` (`roomId`,`created`,`id`);--> statement-breakpoint
CREATE TABLE `chat_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'group' NOT NULL,
	`ownerId` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`avatar` text DEFAULT '' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`username` text,
	`created` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chat_rooms_kind" CHECK("chat_rooms"."kind" IN ('group','secret')),
	CONSTRAINT "chat_rooms_visibility" CHECK("chat_rooms"."visibility" IN ('public','private')),
	CONSTRAINT "chat_rooms_secret_private" CHECK("chat_rooms"."kind" <> 'secret' OR ("chat_rooms"."visibility" = 'private' AND "chat_rooms"."username" IS NULL AND "chat_rooms"."description" = '' AND "chat_rooms"."avatar" = '')),
	CONSTRAINT "chat_rooms_public_username" CHECK(("chat_rooms"."visibility" = 'public' AND "chat_rooms"."username" IS NOT NULL) OR ("chat_rooms"."visibility" = 'private' AND "chat_rooms"."username" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_rooms_username` ON `chat_rooms` (`username`);--> statement-breakpoint
CREATE INDEX `chat_rooms_owner` ON `chat_rooms` (`ownerId`,`updatedAt`);