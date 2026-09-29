CREATE TABLE `chat_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`title` text NOT NULL,
	`emoji` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`includePersonal` integer DEFAULT 0 NOT NULL,
	`includeGroups` integer DEFAULT 0 NOT NULL,
	`includeSecret` integer DEFAULT 0 NOT NULL,
	`excludeRead` integer DEFAULT 0 NOT NULL,
	`excludeArchived` integer DEFAULT 0 NOT NULL,
	`includePeers` text DEFAULT '[]' NOT NULL,
	`excludePeers` text DEFAULT '[]' NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `chat_folders_user` ON `chat_folders` (`userId`,`position`);--> statement-breakpoint
ALTER TABLE `chat_room_messages` ADD `searchText` text;--> statement-breakpoint
CREATE INDEX `chat_room_messages_search_pending` ON `chat_room_messages` (`id`) WHERE "chat_room_messages"."searchText" IS NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `searchText` text;--> statement-breakpoint
CREATE INDEX `messages_search_pending` ON `messages` (`id`) WHERE "messages"."searchText" IS NULL;