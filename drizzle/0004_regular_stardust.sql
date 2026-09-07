CREATE TABLE `auth_challenges` (
	`tokenHash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`linkUserId` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	FOREIGN KEY (`linkUserId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_challenges_expiry` ON `auth_challenges` (`expiresAt`);--> statement-breakpoint
CREATE TABLE `auth_identities` (
	`subject` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`email` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_identity_user` ON `auth_identities` (`userId`);--> statement-breakpoint
CREATE TABLE `auth_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expiresAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_limits_expiry` ON `auth_limits` (`expiresAt`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`tokenHash` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`created` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user` ON `auth_sessions` (`userId`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expiry` ON `auth_sessions` (`expiresAt`);--> statement-breakpoint
ALTER TABLE `users` ADD `onboardingComplete` integer DEFAULT 1 NOT NULL;