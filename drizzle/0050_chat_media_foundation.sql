CREATE TABLE `chat_media_refs` (
	`uploadId` text NOT NULL,
	`surface` text NOT NULL,
	`messageId` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`uploadId`, `surface`, `messageId`),
	FOREIGN KEY (`uploadId`) REFERENCES `uploads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chat_media_refs_surface" CHECK("chat_media_refs"."surface" IN ('dm','room'))
);
--> statement-breakpoint
CREATE INDEX `chat_media_refs_message` ON `chat_media_refs` (`surface`,`messageId`);--> statement-breakpoint
CREATE TABLE `chat_room_uploads` (
	`uploadId` text PRIMARY KEY NOT NULL,
	`roomId` text NOT NULL,
	`size` integer NOT NULL,
	`kind` text NOT NULL,
	`duration` integer DEFAULT 0 NOT NULL,
	`waveform` text DEFAULT '' NOT NULL,
	`messageId` text,
	FOREIGN KEY (`uploadId`) REFERENCES `uploads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`roomId`) REFERENCES `chat_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`messageId`) REFERENCES `chat_room_messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_room_uploads_room` ON `chat_room_uploads` (`roomId`,`messageId`);--> statement-breakpoint
ALTER TABLE `chat_room_messages` ADD `media` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_uploads` ADD `duration` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_uploads` ADD `waveform` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Group attachments follow the same storage guard as direct messages (0028).
CREATE TRIGGER chat_room_messages_media_ready_insert BEFORE INSERT ON chat_room_messages WHEN EXISTS(
  SELECT 1 FROM json_each(NEW.media) m WHERE NOT EXISTS(
    SELECT 1 FROM uploads up WHERE up.id=json_extract(m.value,'$.id') AND up.state='ready'
  )
) BEGIN SELECT RAISE(ABORT,'MEDIA_NOT_READY'); END;
--> statement-breakpoint
CREATE TRIGGER chat_room_messages_media_ready_update BEFORE UPDATE OF media ON chat_room_messages WHEN NEW.media<>OLD.media AND EXISTS(
  SELECT 1 FROM json_each(NEW.media) m WHERE NOT EXISTS(
    SELECT 1 FROM uploads up WHERE up.id=json_extract(m.value,'$.id') AND up.state='ready'
  )
) BEGIN SELECT RAISE(ABORT,'MEDIA_NOT_READY'); END;
--> statement-breakpoint
-- Every stored copy of an attachment is indexed, whichever code path wrote it.
CREATE TRIGGER messages_media_refs_insert AFTER INSERT ON messages WHEN NEW.media<>'[]' BEGIN
  INSERT OR IGNORE INTO chat_media_refs(uploadId,surface,messageId,created)
  SELECT up.id,'dm',NEW.id,NEW.created FROM json_each(NEW.media) m JOIN uploads up ON up.id=json_extract(m.value,'$.id');
END;
--> statement-breakpoint
CREATE TRIGGER messages_media_refs_update AFTER UPDATE OF media ON messages WHEN NEW.media<>OLD.media BEGIN
  DELETE FROM chat_media_refs WHERE surface='dm' AND messageId=OLD.id;
  INSERT OR IGNORE INTO chat_media_refs(uploadId,surface,messageId,created)
  SELECT up.id,'dm',NEW.id,NEW.created FROM json_each(NEW.media) m JOIN uploads up ON up.id=json_extract(m.value,'$.id');
END;
--> statement-breakpoint
CREATE TRIGGER messages_media_refs_delete AFTER DELETE ON messages WHEN OLD.media<>'[]' BEGIN
  DELETE FROM chat_media_refs WHERE surface='dm' AND messageId=OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER chat_room_messages_media_refs_insert AFTER INSERT ON chat_room_messages WHEN NEW.media<>'[]' BEGIN
  INSERT OR IGNORE INTO chat_media_refs(uploadId,surface,messageId,created)
  SELECT up.id,'room',NEW.id,NEW.created FROM json_each(NEW.media) m JOIN uploads up ON up.id=json_extract(m.value,'$.id');
END;
--> statement-breakpoint
CREATE TRIGGER chat_room_messages_media_refs_update AFTER UPDATE OF media ON chat_room_messages WHEN NEW.media<>OLD.media BEGIN
  DELETE FROM chat_media_refs WHERE surface='room' AND messageId=OLD.id;
  INSERT OR IGNORE INTO chat_media_refs(uploadId,surface,messageId,created)
  SELECT up.id,'room',NEW.id,NEW.created FROM json_each(NEW.media) m JOIN uploads up ON up.id=json_extract(m.value,'$.id');
END;
--> statement-breakpoint
CREATE TRIGGER chat_room_messages_media_refs_delete AFTER DELETE ON chat_room_messages WHEN OLD.media<>'[]' BEGIN
  DELETE FROM chat_media_refs WHERE surface='room' AND messageId=OLD.id;
END;
--> statement-breakpoint
-- Index the attachments of existing direct messages, including forwarded copies.
INSERT OR IGNORE INTO chat_media_refs(uploadId,surface,messageId,created)
SELECT up.id,'dm',msg.id,msg.created FROM messages msg,json_each(msg.media) m JOIN uploads up ON up.id=json_extract(m.value,'$.id')
WHERE msg.media<>'[]';
