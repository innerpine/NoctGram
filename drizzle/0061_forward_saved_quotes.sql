ALTER TABLE `chat_room_messages` ADD `forwardedName` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_room_messages` ADD `forwardedFrom` text;--> statement-breakpoint
ALTER TABLE `chat_room_messages` ADD `replyQuote` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_room_messages` ADD `postShareId` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `forwardedFrom` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `replyQuote` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `postShareId` text;