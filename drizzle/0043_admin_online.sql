CREATE TABLE `online_samples` (
	`minute` integer PRIMARY KEY NOT NULL,
	`online` integer NOT NULL,
	`recordedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `users_last_seen` ON `users` (`lastSeen`);