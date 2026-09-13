ALTER TABLE `chat_room_members` ADD `muted` integer DEFAULT 0 NOT NULL CONSTRAINT `chat_room_members_muted` CHECK (`muted` IN (0,1));
