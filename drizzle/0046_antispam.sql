CREATE TABLE `antispam_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`actorId` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `antispam_activity_lookup` ON `antispam_activity` (`fingerprint`,`created`);--> statement-breakpoint
CREATE INDEX `antispam_activity_cleanup` ON `antispam_activity` (`created`);--> statement-breakpoint
CREATE TABLE `antispam_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`targetId` text NOT NULL,
	`actorId` text NOT NULL,
	`contextId` text NOT NULL,
	`text` text NOT NULL,
	`payload` text NOT NULL,
	`reasons` text NOT NULL,
	`digest` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created` integer NOT NULL,
	`reviewedAt` integer DEFAULT 0 NOT NULL,
	`reviewedBy` text,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "antispam_queue_kind" CHECK("antispam_queue"."kind" IN ('post','comment','group')),
	CONSTRAINT "antispam_queue_state" CHECK("antispam_queue"."status" IN ('pending','approved','rejected')),
	CONSTRAINT "antispam_queue_json" CHECK(json_valid("antispam_queue"."payload") AND json_valid("antispam_queue"."reasons"))
);
--> statement-breakpoint
CREATE INDEX `antispam_queue_status` ON `antispam_queue` (`status`,`created`,`id`);--> statement-breakpoint
CREATE INDEX `antispam_queue_actor` ON `antispam_queue` (`actorId`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `antispam_queue_pending_digest` ON `antispam_queue` (`digest`) WHERE "antispam_queue"."status"='pending';--> statement-breakpoint
CREATE TABLE `antispam_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`domains` text DEFAULT '["unixgram.com"]' NOT NULL,
	`raidUntil` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL
);

--> statement-breakpoint
INSERT INTO antispam_settings(id) VALUES(1);
