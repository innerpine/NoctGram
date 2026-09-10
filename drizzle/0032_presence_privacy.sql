CREATE TABLE user_presence_privacy (
  userId TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy TEXT NOT NULL DEFAULT 'everyone' CHECK(policy IN ('everyone','nobody'))
);
--> statement-breakpoint
CREATE TABLE user_presence_exceptions (
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule TEXT NOT NULL CHECK(rule IN ('hide','show')),
  PRIMARY KEY(userId,rule,viewerId),
  CHECK(userId <> viewerId)
);
