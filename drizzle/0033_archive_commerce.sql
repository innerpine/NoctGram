CREATE TABLE `direct_chat_archives` (
	`userId` text NOT NULL,
	`peerId` text NOT NULL,
	`archivedAt` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`userId`, `peerId`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`peerId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `payment_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`requestKey` text NOT NULL,
	`userId` text NOT NULL,
	`telegramId` text,
	`linkId` text,
	`sku` text NOT NULL,
	`product` text NOT NULL,
	`units` integer NOT NULL,
	`provider` text NOT NULL,
	`currency` text NOT NULL,
	`amountMinor` integer NOT NULL,
	`providerInvoiceId` text,
	`checkoutUrl` text,
	`primaryReceipt` text,
	`created` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`fulfilledAt` integer,
	`reversedAt` integer,
	`reviewReason` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_product" CHECK("payment_orders"."product" IN ('stars','premium') AND "payment_orders"."units">0 AND ("payment_orders"."product"<>'premium' OR "payment_orders"."units"=30)),
	CONSTRAINT "payment_provider_currency" CHECK(("payment_orders"."provider"='telegram' AND "payment_orders"."currency"='XTR' AND "payment_orders"."telegramId" IS NOT NULL) OR ("payment_orders"."provider"='crypto' AND "payment_orders"."currency"='RUB')),
	CONSTRAINT "payment_amount" CHECK("payment_orders"."amountMinor">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_order_request` ON `payment_orders` (`userId`,`requestKey`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_provider_invoice` ON `payment_orders` (`provider`,`providerInvoiceId`);--> statement-breakpoint
CREATE INDEX `payment_pending` ON `payment_orders` (`provider`,`fulfilledAt`,`created`);--> statement-breakpoint
CREATE TABLE `payment_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`chargeId` text NOT NULL,
	`orderId` text NOT NULL,
	`currency` text NOT NULL,
	`amountMinor` integer NOT NULL,
	`payerId` text DEFAULT '' NOT NULL,
	`verifiedAt` integer NOT NULL,
	`paidAt` integer,
	`refundedAt` integer,
	FOREIGN KEY (`orderId`) REFERENCES `payment_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_provider_receipt` ON `payment_receipts` (`provider`,`chargeId`);--> statement-breakpoint
CREATE INDEX `payment_receipt_order` ON `payment_receipts` (`orderId`);--> statement-breakpoint
CREATE TABLE `payment_support` (
	`id` text PRIMARY KEY NOT NULL,
	`telegramId` text NOT NULL,
	`text` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `premium_purchases` (
	`orderId` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`startsAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`revokedAt` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`orderId`) REFERENCES `payment_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `premium_purchases_user` ON `premium_purchases` (`userId`,`revokedAt`,`expiresAt`);--> statement-breakpoint
ALTER TABLE `chat_room_members` ADD `archivedAt` integer DEFAULT 0 NOT NULL;