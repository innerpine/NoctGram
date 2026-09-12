CREATE TABLE `gift_collection_sequences` (
	`family` text PRIMARY KEY NOT NULL,
	`lastNumber` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gift_upgrades` (
	`receiptId` text PRIMARY KEY NOT NULL,
	`transferId` text NOT NULL,
	`family` text NOT NULL,
	`number` integer NOT NULL,
	`attributes` text NOT NULL,
	`keepOriginal` integer NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`receiptId`) REFERENCES `received_gifts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transferId`) REFERENCES `star_transfers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "gift_upgrade_number_positive" CHECK("gift_upgrades"."number" > 0),
	CONSTRAINT "gift_upgrade_original_bool" CHECK("gift_upgrades"."keepOriginal" IN (0, 1)),
	CONSTRAINT "gift_upgrade_attributes_json" CHECK(json_valid("gift_upgrades"."attributes"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gift_upgrade_payment` ON `gift_upgrades` (`transferId`);--> statement-breakpoint
CREATE UNIQUE INDEX `gift_collection_number` ON `gift_upgrades` (`family`,`number`);
--> statement-breakpoint
-- A collectible and its Stars payment must belong to the same received gift.
CREATE TRIGGER gift_upgrade_payment_guard BEFORE INSERT ON gift_upgrades
WHEN NOT EXISTS (
  SELECT 1 FROM received_gifts g JOIN star_transfers t ON t.id=NEW.transferId
  WHERE g.id=NEW.receiptId AND g.giftId=NEW.family
    AND t.sender=g.recipient AND t.recipient='noctgram_gifts'
    AND t.kind='gift_upgrade' AND t.amount>0
    AND json_valid(t.postText) AND json_extract(t.postText,'$.receiptId')=g.id
)
BEGIN SELECT RAISE(ABORT, 'INVALID_GIFT_UPGRADE_PAYMENT'); END;
--> statement-breakpoint
CREATE TRIGGER gift_upgrade_immutable BEFORE UPDATE ON gift_upgrades
BEGIN SELECT RAISE(ABORT, 'GIFT_UPGRADE_IMMUTABLE'); END;
