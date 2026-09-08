-- Serialize attachment writes with the storage collector's deleting claim.
CREATE TRIGGER messages_media_ready_insert BEFORE INSERT ON messages WHEN EXISTS(
  SELECT 1 FROM json_each(NEW.media) m WHERE NOT EXISTS(
    SELECT 1 FROM uploads up WHERE up.id=json_extract(m.value,'$.id') AND up.state='ready'
  )
) BEGIN SELECT RAISE(ABORT,'MEDIA_NOT_READY'); END;
--> statement-breakpoint
CREATE TRIGGER messages_media_ready_update BEFORE UPDATE OF media ON messages WHEN NEW.media<>OLD.media AND EXISTS(
  SELECT 1 FROM json_each(NEW.media) m WHERE NOT EXISTS(
    SELECT 1 FROM uploads up WHERE up.id=json_extract(m.value,'$.id') AND up.state='ready'
  )
) BEGIN SELECT RAISE(ABORT,'MEDIA_NOT_READY'); END;
