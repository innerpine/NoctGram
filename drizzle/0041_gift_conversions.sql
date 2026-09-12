CREATE TABLE `gift_conversions` (
	`receiptId` text PRIMARY KEY NOT NULL,
	`transferId` text NOT NULL,
	`amount` integer NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`receiptId`) REFERENCES `received_gifts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transferId`) REFERENCES `star_transfers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "gift_conversion_positive" CHECK(typeof("gift_conversions"."amount") = 'integer' AND "gift_conversions"."amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gift_conversion_payment` ON `gift_conversions` (`transferId`);
--> statement-breakpoint
-- The refund is backed by the actual paid receipt, never the current catalog.
-- Keep sold receipts for the message history and retry/audit trail.
CREATE TRIGGER gift_conversion_payment_guard BEFORE INSERT ON gift_conversions
WHEN NOT EXISTS (
  SELECT 1 FROM received_gifts g
    JOIN star_transfers p ON p.id=g.transferId
    JOIN star_transfers t ON t.id=NEW.transferId
  WHERE g.id=NEW.receiptId AND p.kind='gift' AND p.sender=g.sender
    AND p.recipient='noctgram_gifts' AND typeof(p.amount)='integer'
    AND p.amount BETWEEN 1 AND 9007199254740991
    AND t.id='gift-conversion:'||g.id AND t.kind='gift_conversion'
    AND t.sender='noctgram_gifts' AND t.recipient=g.recipient
    AND t.amount=NEW.amount AND t.created=NEW.created
    AND NEW.amount=(p.amount / 100)*85 + ((p.amount % 100)*85)/100
    AND json_valid(t.postText) AND json_extract(t.postText,'$.receiptId')=g.id
    AND NEW.created>=g.created
    AND NOT EXISTS(SELECT 1 FROM gift_upgrades WHERE receiptId=g.id)
)
BEGIN SELECT RAISE(ABORT, 'INVALID_GIFT_CONVERSION_PAYMENT'); END;
--> statement-breakpoint
CREATE TRIGGER gift_conversion_immutable BEFORE UPDATE ON gift_conversions
BEGIN SELECT RAISE(ABORT, 'GIFT_CONVERSION_IMMUTABLE'); END;
--> statement-breakpoint
-- Also protects an upgrade from an older application worker during deployment.
CREATE TRIGGER gift_upgrade_not_converted BEFORE INSERT ON gift_upgrades
WHEN EXISTS(SELECT 1 FROM gift_conversions WHERE receiptId=NEW.receiptId)
BEGIN SELECT RAISE(ABORT, 'GIFT_ALREADY_CONVERTED'); END;
