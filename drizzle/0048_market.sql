CREATE TABLE `market_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`assetId` text NOT NULL,
	`sellerId` text,
	`price` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`buyerId` text,
	`fee` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	`closed` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`buyerId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "market_listings_kind" CHECK("market_listings"."kind" IN ('number','username','gift')),
	CONSTRAINT "market_listings_status" CHECK("market_listings"."status" IN ('active','sold','cancelled')),
	CONSTRAINT "market_listings_price" CHECK(typeof("market_listings"."price")='integer' AND "market_listings"."price">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_active_asset` ON `market_listings` (`kind`,`assetId`) WHERE "market_listings"."status" = 'active';--> statement-breakpoint
CREATE INDEX `market_catalog` ON `market_listings` (`kind`,`status`,`price`);--> statement-breakpoint
CREATE INDEX `market_history` ON `market_listings` (`kind`,`assetId`,`closed`);--> statement-breakpoint
CREATE INDEX `market_seller` ON `market_listings` (`sellerId`,`status`);--> statement-breakpoint
CREATE TABLE `market_numbers` (
	`number` text PRIMARY KEY NOT NULL,
	`ownerId` text,
	`displayed` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "market_numbers_format" CHECK("market_numbers"."number" GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
	CONSTRAINT "market_numbers_displayed_flag" CHECK("market_numbers"."displayed" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_numbers_displayed` ON `market_numbers` (`ownerId`) WHERE "market_numbers"."displayed" = 1;--> statement-breakpoint
-- An unsold system username is reserved: only the account that paid for the lot may claim it.
CREATE TRIGGER market_reserved_handle BEFORE INSERT ON handles
WHEN EXISTS(SELECT 1 FROM market_listings l WHERE l.kind='username' AND l.assetId=NEW.handle
  AND l.status='active' AND l.sellerId IS NULL
  AND NOT EXISTS(SELECT 1 FROM star_transfers t WHERE t.id='market:'||l.id AND t.sender=NEW.userId AND t.kind='market_sale'))
BEGIN SELECT RAISE(ABORT,'HANDLE_RESERVED'); END;
