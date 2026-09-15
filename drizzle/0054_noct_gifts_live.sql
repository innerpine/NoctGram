CREATE TABLE `gift_consumptions` (
	`receiptId` text PRIMARY KEY NOT NULL,
	`transferId` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`receiptId`) REFERENCES `received_gifts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transferId`) REFERENCES `star_transfers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gift_consumptions_transferId_unique` ON `gift_consumptions` (`transferId`);--> statement-breakpoint
CREATE TRIGGER gift_consumption_operation_guard BEFORE INSERT ON gift_consumptions
WHEN NOT EXISTS (
  SELECT 1 FROM received_gifts g JOIN star_transfers t ON t.id=NEW.transferId
  WHERE g.id=NEW.receiptId AND t.sender=g.recipient AND t.recipient='noctgram_gifts'
    AND t.kind='gift_risk_upgrade' AND t.created=NEW.created
    AND json_extract(t.postText,'$.request.receiptId')=g.id
    AND NOT EXISTS(SELECT 1 FROM gift_upgrades WHERE receiptId=g.id)
    AND NOT EXISTS(SELECT 1 FROM gift_conversions WHERE receiptId=g.id)
)
BEGIN SELECT RAISE(ABORT,'INVALID_GIFT_CONSUMPTION'); END;
--> statement-breakpoint
CREATE TRIGGER gift_consumed_upgrade_guard BEFORE INSERT ON gift_upgrades
WHEN EXISTS(SELECT 1 FROM gift_consumptions WHERE receiptId=NEW.receiptId)
BEGIN SELECT RAISE(ABORT,'GIFT_ALREADY_CONSUMED'); END;
--> statement-breakpoint
CREATE TRIGGER gift_consumption_immutable BEFORE UPDATE ON gift_consumptions
BEGIN SELECT RAISE(ABORT,'GIFT_CONSUMPTION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER gift_consumed_conversion_guard BEFORE INSERT ON gift_conversions
WHEN EXISTS(SELECT 1 FROM gift_consumptions WHERE receiptId=NEW.receiptId)
BEGIN SELECT RAISE(ABORT,'GIFT_ALREADY_CONSUMED'); END;
