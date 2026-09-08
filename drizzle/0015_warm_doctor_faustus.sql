ALTER TABLE `call_signals` ADD `negotiation` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `calls` ADD `negotiation` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `calls` ADD `restartRequested` integer DEFAULT 0 NOT NULL;