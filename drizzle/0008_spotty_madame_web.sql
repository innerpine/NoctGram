CREATE TABLE `premium_entitlements` (
	`userId` text PRIMARY KEY NOT NULL,
	`startsAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`revokedAt` integer DEFAULT 0 NOT NULL,
	`source` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `profile_appearance` (
	`userId` text PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'iris' NOT NULL,
	`nameGradient` integer DEFAULT 0 NOT NULL,
	`ringText` text DEFAULT '' NOT NULL,
	`avatarMotion` text DEFAULT '' NOT NULL,
	`avatarMotionType` text DEFAULT '' NOT NULL,
	`updated` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
