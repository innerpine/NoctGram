CREATE INDEX `calls_active_caller` ON `calls` (`caller`,`created`) WHERE "calls"."status"<>'ended';--> statement-breakpoint
CREATE INDEX `calls_active_callee` ON `calls` (`callee`,`created`) WHERE "calls"."status"<>'ended';--> statement-breakpoint
CREATE INDEX `calls_active_expiry` ON `calls` (`expiresAt`) WHERE "calls"."status"<>'ended';