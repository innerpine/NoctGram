CREATE TABLE `faved_stickers` (
	`userId` text NOT NULL,
	`stickerRef` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`userId`, `stickerRef`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sticker_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`type` text DEFAULT 'stickers' NOT NULL,
	`shortName` text NOT NULL,
	`title` text NOT NULL,
	`stickerCount` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`deletedAt` integer DEFAULT 0 NOT NULL,
	`removedAt` integer DEFAULT 0 NOT NULL,
	`removalId` text,
	FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sticker_packs_type" CHECK("sticker_packs"."type" IN ('stickers','emoji'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sticker_packs_short_name` ON `sticker_packs` (`shortName`);--> statement-breakpoint
CREATE INDEX `sticker_packs_owner` ON `sticker_packs` (`ownerId`,`deletedAt`);--> statement-breakpoint
CREATE TABLE `stickers` (
	`id` text PRIMARY KEY NOT NULL,
	`packId` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`emoji` text NOT NULL,
	`format` text NOT NULL,
	`uploadId` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created` integer NOT NULL,
	`deletedAt` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`packId`) REFERENCES `sticker_packs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploadId`) REFERENCES `uploads`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stickers_format" CHECK("stickers"."format" IN ('webp','png','tgs'))
);
--> statement-breakpoint
CREATE INDEX `stickers_pack` ON `stickers` (`packId`,`deletedAt`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `stickers_upload` ON `stickers` (`uploadId`);--> statement-breakpoint
CREATE TABLE `user_sticker_packs` (
	`userId` text NOT NULL,
	`packRef` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`installedAt` integer NOT NULL,
	PRIMARY KEY(`userId`, `packRef`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `chat_room_messages` ADD `stickerId` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `stickerId` text;