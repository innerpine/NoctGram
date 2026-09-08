ALTER TABLE `messages` ADD `giftReceiptId` text REFERENCES received_gifts(id);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_gift_receipt` ON `messages` (`giftReceiptId`);
--> statement-breakpoint
INSERT INTO messages(id,sender,recipient,text,created,read,giftReceiptId)
SELECT 'gift-message:' || id,sender,recipient,
  '🎁 Подарок' || CASE WHEN message<>'' THEN char(10) || message ELSE '' END,
  created,1,id FROM received_gifts WHERE true
ON CONFLICT(giftReceiptId) DO NOTHING;
