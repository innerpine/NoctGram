CREATE TABLE `call_cancellations` (
	`callId` text NOT NULL,
	`caller` text NOT NULL,
	`device` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`callId`, `caller`, `device`),
	FOREIGN KEY (`caller`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `call_cancellations_expiry` ON `call_cancellations` (`created`);