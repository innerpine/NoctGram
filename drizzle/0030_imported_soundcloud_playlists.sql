ALTER TABLE `music_imports` ADD `localPlaylistId` text REFERENCES music_playlists(id) ON DELETE SET NULL;
