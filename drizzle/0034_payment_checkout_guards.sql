ALTER TABLE `payment_orders` ADD `checkedAt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_orders` ADD `precheckoutId` text;