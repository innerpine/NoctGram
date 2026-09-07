CREATE TABLE `call_signals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`callId` text NOT NULL,
	`sender` text NOT NULL,
	`key` text NOT NULL,
	`candidate` text NOT NULL,
	FOREIGN KEY (`callId`) REFERENCES `calls`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `call_signal_once` ON `call_signals` (`callId`,`sender`,`key`);--> statement-breakpoint
CREATE INDEX `call_signals_order` ON `call_signals` (`callId`,`id`);--> statement-breakpoint
CREATE TABLE `calls` (
	`id` text PRIMARY KEY NOT NULL,
	`caller` text NOT NULL,
	`callee` text NOT NULL,
	`callerDevice` text NOT NULL,
	`calleeDevice` text,
	`status` text DEFAULT 'ringing' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`offer` text,
	`answer` text,
	`created` integer NOT NULL,
	`acceptedAt` integer,
	`endedAt` integer,
	`callerSeen` integer NOT NULL,
	`calleeSeen` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	FOREIGN KEY (`caller`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`callee`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `calls_caller` ON `calls` (`caller`,`created`);--> statement-breakpoint
CREATE INDEX `calls_callee` ON `calls` (`callee`,`created`);--> statement-breakpoint
CREATE TABLE `channel_members` (
	`channelId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`channelId`, `userId`),
	FOREIGN KEY (`channelId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `channel_members_user` ON `channel_members` (`userId`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`actorId` text NOT NULL,
	`kind` text NOT NULL,
	`targetId` text NOT NULL,
	`created` integer NOT NULL,
	`read` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_once` ON `notifications` (`userId`,`kind`,`targetId`);--> statement-breakpoint
CREATE INDEX `notifications_user` ON `notifications` (`userId`,`created`);--> statement-breakpoint
CREATE TABLE `push_deliveries` (
	`notificationId` text NOT NULL,
	`subscriptionId` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`retryAt` integer DEFAULT 0 NOT NULL,
	`lease` text,
	PRIMARY KEY(`notificationId`, `subscriptionId`),
	FOREIGN KEY (`notificationId`) REFERENCES `notifications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscriptionId`) REFERENCES `push_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `push_delivery_retry` ON `push_deliveries` (`state`,`retryAt`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`device` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `push_subscriptions_user` ON `push_subscriptions` (`userId`);--> statement-breakpoint
CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`mediaId` text,
	`text` text DEFAULT '' NOT NULL,
	`background` text DEFAULT 'night' NOT NULL,
	`created` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`deletedAt` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mediaId`) REFERENCES `uploads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stories_expiry` ON `stories` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `stories_author` ON `stories` (`userId`,`created`);--> statement-breakpoint
CREATE TABLE `story_views` (
	`storyId` text NOT NULL,
	`userId` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`storyId`, `userId`),
	FOREIGN KEY (`storyId`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `posts` ADD `publishAt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `posts` ADD `cancelledAt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `posts` ADD `publisherId` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `posts` ADD `notifyPending` integer DEFAULT 0 NOT NULL;