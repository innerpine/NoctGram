import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
} from 'drizzle-orm/sqlite-core';
export const users = sqliteTable('users', {
  id: text().primaryKey(),
  name: text().notNull(),
  bio: text().notNull().default(''),
  avatar: text().notNull().default(''),
  cover: text().notNull().default(''),
  created: integer().notNull(),
});
export const handles = sqliteTable(
  'handles',
  {
    handle: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    main: integer().notNull().default(0),
  },
  (t) => [index('handles_user').on(t.userId)],
);
export const posts = sqliteTable(
  'posts',
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    text: text().notNull(),
    media: text().notNull().default('[]'),
    poll: text().notNull().default('[]'),
    created: integer().notNull(),
  },
  (t) => [
    index('posts_created').on(t.created),
    index('posts_user').on(t.userId),
  ],
);
export const likes = sqliteTable(
  'likes',
  {
    postId: text()
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);
export const bookmarks = sqliteTable(
  'bookmarks',
  {
    postId: text()
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);
export const comments = sqliteTable(
  'comments',
  {
    id: text().primaryKey(),
    postId: text()
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => users.id),
    text: text().notNull(),
    created: integer().notNull(),
  },
  (t) => [index('comments_post').on(t.postId, t.created)],
);
export const votes = sqliteTable(
  'votes',
  {
    postId: text()
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => users.id),
    option: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);
export const follows = sqliteTable(
  'follows',
  {
    follower: text()
      .notNull()
      .references(() => users.id),
    following: text()
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.follower, t.following] })],
);
export const messages = sqliteTable(
  'messages',
  {
    id: text().primaryKey(),
    sender: text()
      .notNull()
      .references(() => users.id),
    recipient: text()
      .notNull()
      .references(() => users.id),
    text: text().notNull(),
    created: integer().notNull(),
    read: integer().notNull().default(0),
  },
  (t) => [
    index('messages_recipient').on(t.recipient, t.created),
    index('messages_sender').on(t.sender, t.created),
  ],
);
export const uploads = sqliteTable('uploads', {
  id: text().primaryKey(),
  userId: text()
    .notNull()
    .references(() => users.id),
  type: text().notNull(),
  name: text().notNull(),
  created: integer().notNull(),
});
