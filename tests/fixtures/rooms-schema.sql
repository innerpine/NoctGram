CREATE TABLE chat_rooms (
  id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL DEFAULT 'group', ownerId TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', visibility TEXT NOT NULL DEFAULT 'private', username TEXT,
  created INTEGER NOT NULL, updatedAt INTEGER NOT NULL, deletedAt INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT chat_rooms_kind CHECK(kind IN ('group','secret')),
  CONSTRAINT chat_rooms_visibility CHECK(visibility IN ('public','private')),
  CONSTRAINT chat_rooms_secret_private CHECK(kind<>'secret' OR (visibility='private' AND username IS NULL AND description='' AND avatar='')),
  CONSTRAINT chat_rooms_public_username CHECK((visibility='public' AND username IS NOT NULL) OR (visibility='private' AND username IS NULL))
);
CREATE UNIQUE INDEX chat_rooms_username ON chat_rooms(username);
CREATE INDEX chat_rooms_owner ON chat_rooms(ownerId,updatedAt);
CREATE TABLE chat_room_members (
  roomId TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE, userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', status TEXT NOT NULL DEFAULT 'active', publicKey TEXT NOT NULL DEFAULT '',
  joinedAt INTEGER NOT NULL, lastReadAt INTEGER NOT NULL DEFAULT 0, lastReadId TEXT NOT NULL DEFAULT '', PRIMARY KEY(roomId,userId),
  CONSTRAINT chat_room_members_role CHECK(role IN ('owner','admin','member')),
  CONSTRAINT chat_room_members_status CHECK(status IN ('active','left','banned'))
);
CREATE INDEX chat_room_members_user ON chat_room_members(userId,status);
CREATE UNIQUE INDEX chat_room_one_owner ON chat_room_members(roomId) WHERE role='owner' AND status='active';
CREATE TABLE chat_room_messages (
  id TEXT PRIMARY KEY NOT NULL, roomId TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE, sender TEXT NOT NULL REFERENCES users(id),
  text TEXT NOT NULL DEFAULT '', ciphertext TEXT, replyTo TEXT, created INTEGER NOT NULL, deletedAt INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT chat_room_message_payload CHECK(ciphertext IS NULL OR (text='' AND replyTo IS NULL))
);
CREATE INDEX chat_room_messages_room ON chat_room_messages(roomId,created,id);
CREATE TABLE chat_room_invites (
  roomId TEXT PRIMARY KEY NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE, tokenHash TEXT NOT NULL UNIQUE,
  createdBy TEXT NOT NULL REFERENCES users(id), created INTEGER NOT NULL
);
