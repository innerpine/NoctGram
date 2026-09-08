DROP INDEX `music_playlist_tracks_order`;--> statement-breakpoint
ALTER TABLE `music_playlist_tracks` ADD `sortOrder` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `music_playlist_tracks_order` ON `music_playlist_tracks` (`playlistId`,`sortOrder`,`created`);