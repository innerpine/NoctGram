-- A real shared group, not a fabricated entry in the conversations list.
-- Only a trusted administrator may be its initial owner; a public handle is
-- never evidence of permission. Existing groups and gift data are untouched.
CREATE TRIGGER IF NOT EXISTS noctgram_community_members_on_create
AFTER INSERT ON chat_rooms
WHEN NEW.id='room:noctgram-community' AND NEW.kind='group' AND NEW.deletedAt=0
BEGIN
  INSERT INTO chat_room_members(roomId,userId,role,status,joinedAt,lastReadAt)
  SELECT NEW.id,u.id,CASE WHEN u.id=NEW.ownerId THEN 'owner' ELSE 'member' END,
    'active',strftime('%s','now')*1000,strftime('%s','now')*1000
  FROM users u
  WHERE u.kind='person' AND u.deletedAt=0 AND u.onboardingComplete=1 AND u.id<>'noctgram'
  ON CONFLICT(roomId,userId) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS noctgram_community_after_administrator
AFTER INSERT ON administrators
BEGIN
  INSERT INTO chat_rooms(id,kind,ownerId,name,description,avatar,visibility,created,updatedAt)
  SELECT 'room:noctgram-community','group',u.id,'Noctgram | Общение',
    'Общий чат Noctgram. Знакомьтесь, общайтесь и делитесь идеями для приложения.',
    '/assets/noctgram-logo.png','private',strftime('%s','now')*1000,strftime('%s','now')*1000
  FROM users u WHERE u.id=NEW.userId AND u.kind='person' AND u.deletedAt=0
    AND u.onboardingComplete=1 AND u.id<>'noctgram'
  ON CONFLICT(id) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS noctgram_community_after_signup
AFTER INSERT ON users
WHEN NEW.kind='person' AND NEW.deletedAt=0 AND NEW.onboardingComplete=1 AND NEW.id<>'noctgram'
BEGIN
  INSERT INTO chat_room_members(roomId,userId,role,status,joinedAt,lastReadAt)
  SELECT r.id,NEW.id,'member','active',strftime('%s','now')*1000,strftime('%s','now')*1000
  FROM chat_rooms r WHERE r.id='room:noctgram-community' AND r.deletedAt=0
  ON CONFLICT(roomId,userId) DO NOTHING;
END;
--> statement-breakpoint
-- Registration via email finishes by switching onboardingComplete from 0 to 1.
-- Also handles a trusted administrator whose onboarding was pending at grant.
CREATE TRIGGER IF NOT EXISTS noctgram_community_after_onboarding
AFTER UPDATE OF onboardingComplete ON users
WHEN NEW.kind='person' AND NEW.deletedAt=0 AND NEW.onboardingComplete=1 AND NEW.id<>'noctgram'
BEGIN
  INSERT INTO chat_rooms(id,kind,ownerId,name,description,avatar,visibility,created,updatedAt)
  SELECT 'room:noctgram-community','group',NEW.id,'Noctgram | Общение',
    'Общий чат Noctgram. Знакомьтесь, общайтесь и делитесь идеями для приложения.',
    '/assets/noctgram-logo.png','private',strftime('%s','now')*1000,strftime('%s','now')*1000
  WHERE EXISTS(SELECT 1 FROM administrators WHERE userId=NEW.id)
  ON CONFLICT(id) DO NOTHING;
  INSERT INTO chat_room_members(roomId,userId,role,status,joinedAt,lastReadAt)
  SELECT r.id,NEW.id,CASE WHEN r.ownerId=NEW.id THEN 'owner' ELSE 'member' END,
    'active',strftime('%s','now')*1000,strftime('%s','now')*1000
  FROM chat_rooms r WHERE r.id='room:noctgram-community' AND r.deletedAt=0
  ON CONFLICT(roomId,userId) DO NOTHING;
END;
--> statement-breakpoint
INSERT INTO chat_rooms(id,kind,ownerId,name,description,avatar,visibility,created,updatedAt)
SELECT 'room:noctgram-community','group',u.id,'Noctgram | Общение',
  'Общий чат Noctgram. Знакомьтесь, общайтесь и делитесь идеями для приложения.',
  '/assets/noctgram-logo.png','private',strftime('%s','now')*1000,strftime('%s','now')*1000
FROM administrators a JOIN users u ON u.id=a.userId
WHERE u.kind='person' AND u.deletedAt=0 AND u.onboardingComplete=1 AND u.id<>'noctgram'
ORDER BY CASE WHEN u.id='local_seedy' THEN 0 ELSE 1 END,a.created,u.id LIMIT 1
ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
-- Idempotent backfill. Never reset a person's role, unread cursor, archive,
-- voluntary departure or ban on another migration / registration retry.
INSERT INTO chat_room_members(roomId,userId,role,status,joinedAt,lastReadAt)
SELECT r.id,u.id,CASE WHEN u.id=r.ownerId THEN 'owner' ELSE 'member' END,
  'active',strftime('%s','now')*1000,strftime('%s','now')*1000
FROM chat_rooms r,users u
WHERE r.id='room:noctgram-community' AND r.deletedAt=0
  AND u.kind='person' AND u.deletedAt=0 AND u.onboardingComplete=1 AND u.id<>'noctgram'
ON CONFLICT(roomId,userId) DO NOTHING;
