CREATE TABLE `received_gifts` (
	`id` text PRIMARY KEY NOT NULL,
	`transferId` text NOT NULL,
	`giftId` text NOT NULL,
	`sender` text NOT NULL,
	`recipient` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`hidden` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`transferId`) REFERENCES `star_transfers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sender`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gifts_transfer` ON `received_gifts` (`transferId`);--> statement-breakpoint
CREATE INDEX `gifts_recipient` ON `received_gifts` (`recipient`,`created`,`id`);
--> statement-breakpoint
-- Gift purchases debit Stars into a non-public service account. Recipients get
-- the gift itself, not a second spendable copy of its Stars price.
INSERT OR IGNORE INTO users(id,name,kind,onboardingComplete,created)
VALUES('noctgram_gifts','Подарки Noctgram','service',0,0);
