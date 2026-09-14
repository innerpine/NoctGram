CREATE TABLE `access_block_rules` (
	`blockId` text NOT NULL,
	`kind` text NOT NULL,
	`valueHash` text NOT NULL,
	`label` text NOT NULL,
	PRIMARY KEY(`blockId`, `kind`, `valueHash`),
	FOREIGN KEY (`blockId`) REFERENCES `access_blocks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "access_rule_kind" CHECK("access_block_rules"."kind" IN ('ip','device'))
);
--> statement-breakpoint
CREATE INDEX `access_rule_lookup` ON `access_block_rules` (`kind`,`valueHash`);--> statement-breakpoint
CREATE TABLE `access_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`targetId` text NOT NULL,
	`actorId` text NOT NULL,
	`reason` text NOT NULL,
	`request` text NOT NULL,
	`created` integer NOT NULL,
	`revokedAt` integer DEFAULT 0 NOT NULL,
	`revokedBy` text,
	FOREIGN KEY (`targetId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revokedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `access_block_target` ON `access_blocks` (`targetId`,`revokedAt`);--> statement-breakpoint
CREATE INDEX `access_block_created` ON `access_blocks` (`created`);--> statement-breakpoint
CREATE TABLE `access_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`kind` text NOT NULL,
	`valueHash` text NOT NULL,
	`label` text NOT NULL,
	`firstSeen` integer NOT NULL,
	`lastSeen` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "access_observation_kind" CHECK("access_observations"."kind" IN ('ip','device'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_observation_identity` ON `access_observations` (`userId`,`kind`,`valueHash`);--> statement-breakpoint
CREATE INDEX `access_observation_shared` ON `access_observations` (`kind`,`valueHash`,`lastSeen`);--> statement-breakpoint
CREATE INDEX `access_observation_age` ON `access_observations` (`lastSeen`);