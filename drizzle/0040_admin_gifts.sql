ALTER TABLE `admin_events` ADD `payload` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
DROP TRIGGER gift_upgrade_payment_guard;
--> statement-breakpoint
-- Paid upgrades keep the original payment requirement. Free issuance must be
-- backed by the exact canonical administrator event and its zero-value ledger row.
CREATE TRIGGER gift_upgrade_payment_guard BEFORE INSERT ON gift_upgrades
WHEN NOT EXISTS (
  SELECT 1 FROM received_gifts g JOIN star_transfers t ON t.id=NEW.transferId
  WHERE g.id=NEW.receiptId AND g.giftId=NEW.family
    AND t.sender=g.recipient AND t.recipient='noctgram_gifts'
    AND t.kind='gift_upgrade' AND t.amount>0
    AND json_valid(t.postText) AND json_extract(t.postText,'$.receiptId')=g.id
) AND NOT EXISTS (
  SELECT 1 FROM received_gifts g
    JOIN star_transfers t ON t.id=NEW.transferId AND g.transferId=t.id
    JOIN admin_events e ON e.id=json_extract(t.postText,'$.adminEventId')
  WHERE g.id=NEW.receiptId AND g.giftId=NEW.family
    AND t.kind='gift_admin' AND t.amount=0 AND t.sender IS NULL AND t.recipient='noctgram_gifts'
    AND json_valid(t.postText) AND json_valid(e.payload)
    AND e.action='collectible' AND e.actorId=g.sender AND e.targetId=g.recipient
    AND json_extract(e.payload,'$.giftId')=NEW.family
    AND json_type(e.payload,'$.count')='integer'
    AND e.amount=json_extract(e.payload,'$.count') AND e.amount BETWEEN 1 AND 10
    AND json_type(e.payload,'$.firstNumber')='integer'
    AND json_extract(e.payload,'$.firstNumber') BETWEEN 1 AND 9007199254740991-e.amount+1
    AND json_type(t.postText,'$.index')='integer'
    AND json_extract(t.postText,'$.index') BETWEEN 0 AND e.amount-1
    AND g.id=e.id||':'||json_extract(t.postText,'$.index') AND t.id=g.id
    AND json_extract(t.postText,'$.receiptId')=g.id
    AND NEW.number=json_extract(e.payload,'$.firstNumber')+json_extract(t.postText,'$.index')
    AND NEW.attributes=json_extract(e.payload,'$.attributes')
    AND json_extract(NEW.attributes,'$.issuance')='admin'
    AND NEW.keepOriginal=json_extract(e.payload,'$.keepOriginal')
    AND g.message=json_extract(e.payload,'$.message')
    AND NEW.created=e.created AND g.created=e.created AND t.created=e.created
)
BEGIN SELECT RAISE(ABORT, 'INVALID_GIFT_UPGRADE_PAYMENT'); END;
--> statement-breakpoint
-- Manual high numbers reserve the next normal number as well. The existing
-- UNIQUE(family,number) index must abort a collision, never ignore or replace it.
CREATE TRIGGER gift_upgrade_advance_sequence AFTER INSERT ON gift_upgrades
BEGIN
  INSERT INTO gift_collection_sequences(family,lastNumber) VALUES(NEW.family,NEW.number)
  ON CONFLICT(family) DO UPDATE SET lastNumber=MAX(lastNumber,NEW.number);
END;
--> statement-breakpoint
INSERT INTO gift_collection_sequences(family,lastNumber)
SELECT family,MAX(number) FROM gift_upgrades WHERE 1 GROUP BY family
ON CONFLICT(family) DO UPDATE SET lastNumber=MAX(lastNumber,excluded.lastNumber);
