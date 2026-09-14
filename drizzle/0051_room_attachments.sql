ALTER TABLE chat_room_messages ADD COLUMN media text NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE TABLE room_uploads (
  uploadId text PRIMARY KEY NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  roomId text NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  messageId text REFERENCES chat_room_messages(id) ON DELETE CASCADE,
  size integer NOT NULL,
  kind text NOT NULL
);
--> statement-breakpoint
CREATE INDEX room_uploads_message ON room_uploads(messageId);
--> statement-breakpoint
CREATE TRIGGER room_media_insert_guard BEFORE INSERT ON chat_room_messages
WHEN NEW.media <> '[]'
BEGIN
  SELECT CASE WHEN NEW.ciphertext IS NOT NULL OR NOT EXISTS(SELECT 1 FROM chat_rooms WHERE id=NEW.roomId AND kind='group')
    OR EXISTS(SELECT 1 FROM json_each(NEW.media) j WHERE NOT EXISTS(
      SELECT 1 FROM uploads u JOIN room_uploads f ON f.uploadId=u.id
      WHERE u.id=json_extract(j.value,'$.id') AND u.state='ready' AND u.userId=NEW.sender
        AND f.roomId=NEW.roomId AND (f.messageId IS NULL OR f.messageId=NEW.id)
        AND NOT EXISTS(SELECT 1 FROM moderated_uploads m WHERE m.uploadId=u.id)))
    THEN RAISE(ABORT, 'Room attachment unavailable') END;
END;
--> statement-breakpoint
CREATE TRIGGER room_media_claim AFTER INSERT ON chat_room_messages
BEGIN
  UPDATE room_uploads SET messageId=NEW.id
    WHERE messageId IS NULL AND roomId=NEW.roomId
      AND uploadId IN(SELECT json_extract(value,'$.id') FROM json_each(NEW.media));
END;
