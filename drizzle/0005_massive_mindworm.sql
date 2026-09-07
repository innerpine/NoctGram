CREATE TABLE `content_removals` (
	`id` text PRIMARY KEY NOT NULL,
	`targetType` text NOT NULL,
	`targetId` text NOT NULL,
	`postId` text NOT NULL,
	`authorId` text NOT NULL,
	`moderatorId` text NOT NULL,
	`text` text NOT NULL,
	`snapshot` text NOT NULL,
	`reason` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`moderatorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_removal_once` ON `content_removals` (`targetType`,`targetId`);--> statement-breakpoint
CREATE INDEX `content_removals_created` ON `content_removals` (`created`,`id`);--> statement-breakpoint
CREATE TABLE `content_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`targetType` text NOT NULL,
	`targetId` text NOT NULL,
	`postId` text NOT NULL,
	`userId` text NOT NULL,
	`authorId` text NOT NULL,
	`text` text NOT NULL,
	`snapshot` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL,
	`reviewedBy` text,
	`reviewNote` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_report_once` ON `content_reports` (`targetType`,`targetId`,`userId`);--> statement-breakpoint
CREATE INDEX `content_reports_queue` ON `content_reports` (`status`,`created`,`id`);--> statement-breakpoint
CREATE INDEX `content_reports_post` ON `content_reports` (`postId`);--> statement-breakpoint
CREATE TABLE `moderated_uploads` (
	`uploadId` text PRIMARY KEY NOT NULL,
	`removalId` text NOT NULL,
	FOREIGN KEY (`uploadId`) REFERENCES `uploads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`removalId`) REFERENCES `content_removals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO content_reports(id,targetType,targetId,postId,userId,authorId,text,snapshot,reason,status,created,updated)
SELECT 'legacy:'||r.postId||':'||r.userId,'post',r.postId,r.postId,r.userId,p.userId,p.text,
  json_object('id',p.id,'userId',p.userId,'text',p.text,'media',json(p.media),'code',p.code,'poll',json(p.poll)),
  r.reason,'new',r.created,r.created FROM reports r JOIN posts p ON p.id=r.postId;
