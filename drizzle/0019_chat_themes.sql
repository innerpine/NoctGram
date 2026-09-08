CREATE TABLE `chat_themes` (
	`firstId` text NOT NULL,
	`secondId` text NOT NULL,
	`sharedTheme` text DEFAULT 'noct' NOT NULL,
	`firstTheme` text,
	`secondTheme` text,
	`revision` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`firstId`, `secondId`),
	FOREIGN KEY (`firstId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`secondId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
