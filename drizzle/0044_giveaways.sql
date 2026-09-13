CREATE TABLE `giveaway_winners` (
	`giveawayId` text NOT NULL,
	`userId` text NOT NULL,
	`position` integer NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`giveawayId`, `userId`),
	FOREIGN KEY (`giveawayId`) REFERENCES `giveaways`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `giveaway_winners_position` ON `giveaway_winners` (`giveawayId`,`position`);--> statement-breakpoint
CREATE TABLE `giveaways` (
	`id` text PRIMARY KEY NOT NULL,
	`creator` text NOT NULL,
	`targetKind` text NOT NULL,
	`targetId` text NOT NULL,
	`prize` text NOT NULL,
	`winnerCount` integer NOT NULL,
	`starsPerWinner` integer NOT NULL,
	`premiumDays` integer DEFAULT 30 NOT NULL,
	`totalCost` integer NOT NULL,
	`payload` text NOT NULL,
	`created` integer NOT NULL,
	`endsAt` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`drawToken` text DEFAULT '' NOT NULL,
	`completedAt` integer DEFAULT 0 NOT NULL,
	`participantCount` integer DEFAULT 0 NOT NULL,
	`refund` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`creator`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "giveaways_target" CHECK("giveaways"."targetKind" IN ('group','channel')),
	CONSTRAINT "giveaways_prize" CHECK("giveaways"."prize" IN ('stars','premium')),
	CONSTRAINT "giveaways_count" CHECK("giveaways"."winnerCount" BETWEEN 1 AND 50),
	CONSTRAINT "giveaways_stars" CHECK("giveaways"."starsPerWinner" BETWEEN 0 AND 100000),
	CONSTRAINT "giveaways_premium_days" CHECK("giveaways"."premiumDays"=30),
	CONSTRAINT "giveaways_cost" CHECK("giveaways"."totalCost" BETWEEN 1 AND 1000000),
	CONSTRAINT "giveaways_status" CHECK("giveaways"."status" IN ('active','settling','completed')),
	CONSTRAINT "giveaways_time" CHECK("giveaways"."endsAt">"giveaways"."created"),
	CONSTRAINT "giveaways_budget" CHECK(("giveaways"."prize"='premium' AND "giveaways"."starsPerWinner"=0 AND "giveaways"."totalCost"="giveaways"."winnerCount"*500) OR ("giveaways"."prize"='stars' AND "giveaways"."starsPerWinner">0 AND "giveaways"."totalCost"="giveaways"."winnerCount"*"giveaways"."starsPerWinner"))
);
--> statement-breakpoint
CREATE INDEX `giveaways_due` ON `giveaways` (`status`,`endsAt`);--> statement-breakpoint
CREATE INDEX `giveaways_creator` ON `giveaways` (`creator`,`status`);--> statement-breakpoint
ALTER TABLE `chat_room_messages` ADD `giveawayId` text REFERENCES giveaways(id);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_room_messages_giveaway` ON `chat_room_messages` (`giveawayId`);--> statement-breakpoint
ALTER TABLE `posts` ADD `giveawayId` text REFERENCES giveaways(id);--> statement-breakpoint
CREATE UNIQUE INDEX `posts_giveaway` ON `posts` (`giveawayId`);
--> statement-breakpoint
INSERT OR IGNORE INTO users(id,name,kind,onboardingComplete,created)
VALUES('noctgram_giveaways','Розыгрыши Noctgram','system',0,0);
--> statement-breakpoint
CREATE TRIGGER giveaway_post_binding BEFORE INSERT ON posts WHEN NEW.giveawayId IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM giveaways g WHERE g.id=NEW.giveawayId AND g.targetKind='channel' AND g.targetId=NEW.userId AND g.creator=NEW.publisherId AND NEW.id='giveaway-post:'||g.id
) BEGIN SELECT RAISE(ABORT,'GIVEAWAY_BINDING'); END;
--> statement-breakpoint
CREATE TRIGGER giveaway_post_binding_update BEFORE UPDATE OF giveawayId,userId,publisherId ON posts WHEN NEW.giveawayId IS NOT OLD.giveawayId OR (NEW.giveawayId IS NOT NULL AND (NEW.userId IS NOT OLD.userId OR NEW.publisherId IS NOT OLD.publisherId)) BEGIN SELECT RAISE(ABORT,'GIVEAWAY_BINDING'); END;
--> statement-breakpoint
CREATE TRIGGER giveaway_message_binding BEFORE INSERT ON chat_room_messages WHEN NEW.giveawayId IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM giveaways g WHERE g.id=NEW.giveawayId AND g.targetKind='group' AND g.targetId=NEW.roomId AND g.creator=NEW.sender AND NEW.id='giveaway-message:'||g.id AND NEW.ciphertext IS NULL
) BEGIN SELECT RAISE(ABORT,'GIVEAWAY_BINDING'); END;
--> statement-breakpoint
CREATE TRIGGER giveaway_message_binding_update BEFORE UPDATE OF giveawayId,roomId,sender,ciphertext ON chat_room_messages WHEN NEW.giveawayId IS NOT OLD.giveawayId OR (NEW.giveawayId IS NOT NULL AND (NEW.roomId IS NOT OLD.roomId OR NEW.sender IS NOT OLD.sender OR NEW.ciphertext IS NOT OLD.ciphertext)) BEGIN SELECT RAISE(ABORT,'GIVEAWAY_BINDING'); END;
