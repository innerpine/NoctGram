import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const users = sqliteTable('users', {
  id: text().primaryKey(),
  name: text().notNull(),
  bio: text().notNull().default(''),
  avatar: text().notNull().default(''),
  cover: text().notNull().default(''),
  created: integer().notNull(),
  lastSeen: integer().notNull().default(0),
  onboardingComplete: integer().notNull().default(1),
  kind: text().notNull().default('person'),
  verified: integer().notNull().default(0),
  deletedAt: integer().notNull().default(0),
  sessionsRevokedAt: integer().notNull().default(0),
  ownerId: text().references((): AnySQLiteColumn => users.id),
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
    pinned: integer().notNull().default(0),
    code: text().notNull().default(''),
    codeLang: text().notNull().default('text'),
    adult: integer().notNull().default(0),
    publishAt: integer().notNull().default(0),
    cancelledAt: integer().notNull().default(0),
    publisherId: text().references(() => users.id),
    notifyPending: integer().notNull().default(0),
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
  bytes: integer().notNull().default(0),
  state: text().notNull().default('ready'),
  created: integer().notNull(),
});

export const hiddenPosts = sqliteTable(
  'hidden_posts',
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
export const reports = sqliteTable(
  'reports',
  {
    postId: text()
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => users.id),
    reason: text().notNull(),
    created: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);

export const postViews = sqliteTable(
  'post_views',
  {
    postId: text()
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => users.id),
    created: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);

// Balances are derived from this ledger. Transfers use a single conditional INSERT.
export const starTransfers = sqliteTable(
  'star_transfers',
  {
    id: text().primaryKey(),
    sender: text().references(() => users.id),
    recipient: text()
      .notNull()
      .references(() => users.id),
    postId: text().references(() => posts.id, { onDelete: 'set null' }),
    postText: text().notNull().default(''),
    amount: integer().notNull(),
    kind: text().notNull(),
    created: integer().notNull(),
  },
  (t) => [
    index('stars_sender').on(t.sender, t.created),
    index('stars_recipient').on(t.recipient, t.created),
    index('stars_post').on(t.postId, t.sender),
    uniqueIndex('stars_one_grant')
      .on(t.recipient)
      .where(sql`${t.kind} = 'grant'`),
  ],
);

// Moderators are granted by an owner-controlled database operation, never signup.
export const moderators = sqliteTable('moderators', {
  userId: text()
    .primaryKey()
    .references(() => users.id),
  created: integer().notNull(),
});
export const moderationEvents = sqliteTable(
  'moderation_events',
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    moderatorId: text()
      .notNull()
      .references(() => users.id),
    mode: text().notNull(),
    reason: text().notNull(),
    expiresAt: integer(),
    created: integer().notNull(),
  },
  (t) => [index('moderation_events_user').on(t.userId, t.created)],
);
export const accountRestrictions = sqliteTable('account_restrictions', {
  userId: text()
    .primaryKey()
    .references(() => users.id),
  eventId: text()
    .notNull()
    .references(() => moderationEvents.id),
  mode: text().notNull(),
  reason: text().notNull(),
  expiresAt: integer(),
  created: integer().notNull(),
});
export const moderationAppeals = sqliteTable(
  'moderation_appeals',
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    eventId: text()
      .notNull()
      .references(() => moderationEvents.id),
    text: text().notNull(),
    status: text().notNull().default('pending'),
    created: integer().notNull(),
    reviewedBy: text().references(() => users.id),
    reviewedAt: integer(),
    reviewNote: text().notNull().default(''),
  },
  (t) => [
    uniqueIndex('appeal_event').on(t.eventId),
    index('appeals_status').on(t.status, t.created),
  ],
);

export const administrators = sqliteTable('administrators', {
  userId: text()
    .primaryKey()
    .references(() => users.id),
  created: integer().notNull(),
});
export const accountDeletions = sqliteTable('account_deletions', {
  userId: text()
    .primaryKey()
    .references(() => users.id),
  requestId: text().notNull().unique(),
  created: integer().notNull(),
});
export const storageDeletions = sqliteTable('storage_deletions', {
  objectKey: text().primaryKey(),
  created: integer().notNull(),
});
export const adminEvents = sqliteTable(
  'admin_events',
  {
    id: text().primaryKey(),
    actorId: text()
      .notNull()
      .references(() => users.id),
    targetId: text()
      .notNull()
      .references(() => users.id),
    action: text().notNull(),
    amount: integer().notNull().default(0),
    reason: text().notNull(),
    created: integer().notNull(),
  },
  (t) => [index('admin_events_created').on(t.created)],
);
export const recoveryCodes = sqliteTable(
  'recovery_codes',
  {
    hash: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    created: integer().notNull(),
    expiresAt: integer().notNull(),
  },
  (t) => [index('recovery_codes_user').on(t.userId)],
);
export const accountChallenges = sqliteTable(
  'account_challenges',
  {
    id: text().primaryKey(),
    sessionHash: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id),
    purpose: text().notNull(),
    subject: text().notNull(),
    email: text().notNull(),
    attempts: integer().notNull().default(0),
    created: integer().notNull(),
    expiresAt: integer().notNull(),
  },
  (t) => [
    index('account_challenges_session').on(t.sessionHash),
    index('account_challenges_expiry').on(t.expiresAt),
  ],
);

// Email proof is owned by Supabase. No OTPs or provider tokens are stored here.
export const authIdentities = sqliteTable(
  'auth_identities',
  {
    subject: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    email: text().notNull(),
    created: integer().notNull(),
  },
  (t) => [uniqueIndex('auth_identity_user').on(t.userId)],
);
export const authSessions = sqliteTable(
  'auth_sessions',
  {
    tokenHash: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    created: integer().notNull(),
    expiresAt: integer().notNull(),
    verifiedAt: integer().notNull().default(0),
  },
  (t) => [
    index('auth_sessions_user').on(t.userId),
    index('auth_sessions_expiry').on(t.expiresAt),
  ],
);
export const authChallenges = sqliteTable(
  'auth_challenges',
  {
    tokenHash: text().primaryKey(),
    email: text().notNull(),
    linkUserId: text().references(() => users.id),
    attempts: integer().notNull().default(0),
    created: integer().notNull(),
    expiresAt: integer().notNull(),
  },
  (t) => [index('auth_challenges_expiry').on(t.expiresAt)],
);
export const authLimits = sqliteTable(
  'auth_limits',
  {
    key: text().primaryKey(),
    count: integer().notNull(),
    expiresAt: integer().notNull(),
  },
  (t) => [index('auth_limits_expiry').on(t.expiresAt)],
);

// Reports and decisions keep their evidence when the original content is deleted.
export const contentReports = sqliteTable(
  'content_reports',
  {
    id: text().primaryKey(),
    targetType: text().notNull(),
    targetId: text().notNull(),
    postId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id),
    authorId: text()
      .notNull()
      .references(() => users.id),
    text: text().notNull(),
    snapshot: text().notNull(),
    reason: text().notNull(),
    status: text().notNull().default('new'),
    created: integer().notNull(),
    updated: integer().notNull(),
    reviewedBy: text().references(() => users.id),
    reviewNote: text().notNull().default(''),
  },
  (t) => [
    uniqueIndex('content_report_once').on(t.targetType, t.targetId, t.userId),
    index('content_reports_queue').on(t.status, t.created, t.id),
    index('content_reports_post').on(t.postId),
  ],
);
export const contentRemovals = sqliteTable(
  'content_removals',
  {
    id: text().primaryKey(),
    targetType: text().notNull(),
    targetId: text().notNull(),
    postId: text().notNull(),
    authorId: text()
      .notNull()
      .references(() => users.id),
    moderatorId: text()
      .notNull()
      .references(() => users.id),
    text: text().notNull(),
    snapshot: text().notNull(),
    reason: text().notNull(),
    created: integer().notNull(),
  },
  (t) => [
    uniqueIndex('content_removal_once').on(t.targetType, t.targetId),
    index('content_removals_created').on(t.created, t.id),
  ],
);
export const moderatedUploads = sqliteTable('moderated_uploads', {
  uploadId: text()
    .primaryKey()
    .references(() => uploads.id),
  removalId: text()
    .notNull()
    .references(() => contentRemovals.id),
});

// Personal settings never appear in another user's public profile.
export const userPrivacy = sqliteTable('user_privacy', {
  userId: text()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  hideAdult: integer().notNull().default(0),
  messagePolicy: text().notNull().default('everyone'),
});
export const userBlocks = sqliteTable(
  'user_blocks',
  {
    blocker: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blocked: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    created: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.blocker, t.blocked] }),
    index('user_blocks_reverse').on(t.blocked, t.blocker),
  ],
);

export const musicTracks = sqliteTable('music_tracks', {
  id: text().primaryKey(),
  url: text().notNull().unique(),
  kind: text().notNull(),
  provider: text().notNull().default('soundcloud'),
  durationMs: integer().notNull().default(0),
  title: text().notNull(),
  artist: text().notNull(),
  artwork: text().notNull().default(''),
  authorUrl: text().notNull(),
  created: integer().notNull(),
});
export const musicLibrary = sqliteTable(
  'music_library',
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    trackId: text()
      .notNull()
      .references(() => musicTracks.id, { onDelete: 'cascade' }),
    created: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.trackId] }),
    index('music_library_track').on(t.trackId),
  ],
);
export const musicPreferences = sqliteTable('music_preferences', {
  userId: text()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  participate: integer().notNull().default(0),
});
export const musicAudio = sqliteTable(
  'music_audio',
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    trackId: text()
      .notNull()
      .references(() => musicTracks.id, { onDelete: 'cascade' }),
    objectKey: text().notNull().unique(),
    mime: text().notNull(),
    size: integer().notNull(),
    created: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.trackId] })],
);
// One active session per listener prevents parallel tabs from multiplying scores.
export const musicSessions = sqliteTable('music_sessions', {
  userId: text()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  id: text().notNull().unique(),
  trackId: text()
    .notNull()
    .references(() => musicTracks.id, { onDelete: 'cascade' }),
  created: integer().notNull(),
  updated: integer().notNull(),
  totalMs: integer().notNull().default(0),
});
export const musicListens = sqliteTable(
  'music_listens',
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    trackId: text()
      .notNull()
      .references(() => musicTracks.id, { onDelete: 'cascade' }),
    day: integer().notNull(),
    created: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.trackId, t.day] }),
    index('music_listens_recent').on(t.created, t.trackId),
  ],
);

export const musicConnections = sqliteTable(
  'music_connections',
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    id: text().notNull(),
    accountId: text().notNull(),
    displayName: text().notNull(),
    profileUrl: text().notNull(),
    sealedTokens: text().notNull(),
    expiresAt: integer().notNull(),
    status: text().notNull().default('connected'),
    refreshLock: text().notNull().default(''),
    refreshUntil: integer().notNull().default(0),
    updated: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.provider] })],
);
export const musicOauthStates = sqliteTable(
  'music_oauth_states',
  {
    stateHash: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    browserHash: text().notNull(),
    sealedVerifier: text().notNull(),
    consumed: integer().notNull().default(0),
    expiresAt: integer().notNull(),
  },
  (t) => [index('music_oauth_expiry').on(t.expiresAt)],
);
// Imported account playlists stay private; they never enter the public discovery/chart tables.
export const musicImports = sqliteTable(
  'music_imports',
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    playlistId: text().notNull(),
    connectionId: text().notNull(),
    title: text().notNull(),
    url: text().notNull(),
    artwork: text().notNull().default(''),
    trackCount: integer().notNull().default(0),
    playable: integer().notNull().default(0),
    imported: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.provider, t.playlistId] })],
);

export const channelMembers = sqliteTable(
  'channel_members',
  {
    channelId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text().notNull(),
    created: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.userId] }),
    index('channel_members_user').on(t.userId),
  ],
);
export const stories = sqliteTable(
  'stories',
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    mediaId: text().references(() => uploads.id),
    text: text().notNull().default(''),
    background: text().notNull().default('night'),
    created: integer().notNull(),
    expiresAt: integer().notNull(),
    deletedAt: integer().notNull().default(0),
  },
  (t) => [
    index('stories_expiry').on(t.expiresAt),
    index('stories_author').on(t.userId, t.created),
  ],
);
export const storyViews = sqliteTable(
  'story_views',
  {
    storyId: text()
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => users.id),
    created: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.storyId, t.userId] })],
);
export const calls = sqliteTable(
  'calls',
  {
    id: text().primaryKey(),
    caller: text()
      .notNull()
      .references(() => users.id),
    callee: text()
      .notNull()
      .references(() => users.id),
    callerDevice: text().notNull(),
    calleeDevice: text(),
    status: text().notNull().default('ringing'),
    reason: text().notNull().default(''),
    offer: text(),
    answer: text(),
    created: integer().notNull(),
    acceptedAt: integer(),
    endedAt: integer(),
    callerSeen: integer().notNull(),
    calleeSeen: integer().notNull(),
    expiresAt: integer().notNull(),
  },
  (t) => [
    index('calls_caller').on(t.caller, t.created),
    index('calls_callee').on(t.callee, t.created),
  ],
);
export const callSignals = sqliteTable(
  'call_signals',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    callId: text()
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    sender: text()
      .notNull()
      .references(() => users.id),
    key: text().notNull(),
    candidate: text().notNull(),
  },
  (t) => [
    uniqueIndex('call_signal_once').on(t.callId, t.sender, t.key),
    index('call_signals_order').on(t.callId, t.id),
  ],
);
export const notifications = sqliteTable(
  'notifications',
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    actorId: text()
      .notNull()
      .references(() => users.id),
    kind: text().notNull(),
    targetId: text().notNull(),
    created: integer().notNull(),
    read: integer().notNull().default(0),
  },
  (t) => [
    uniqueIndex('notification_once').on(t.userId, t.kind, t.targetId),
    index('notifications_user').on(t.userId, t.created),
  ],
);
export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    device: text().notNull(),
    endpoint: text().notNull(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    created: integer().notNull(),
    expiresAt: integer().notNull(),
  },
  (t) => [index('push_subscriptions_user').on(t.userId)],
);
export const pushDeliveries = sqliteTable(
  'push_deliveries',
  {
    notificationId: text()
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    subscriptionId: text()
      .notNull()
      .references(() => pushSubscriptions.id, { onDelete: 'cascade' }),
    state: text().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    retryAt: integer().notNull().default(0),
    lease: text(),
  },
  (t) => [
    primaryKey({ columns: [t.notificationId, t.subscriptionId] }),
    index('push_delivery_retry').on(t.state, t.retryAt),
  ],
);

export const premiumEntitlements = sqliteTable('premium_entitlements', {
  userId: text()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  startsAt: integer().notNull(),
  expiresAt: integer().notNull(),
  revokedAt: integer().notNull().default(0),
  source: text().notNull(),
  created: integer().notNull(),
});
export const profileAppearance = sqliteTable('profile_appearance', {
  userId: text()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  theme: text().notNull().default('iris'),
  nameGradient: integer().notNull().default(0),
  ringText: text().notNull().default(''),
  chromeFlow: integer().notNull().default(0),
  chromeTempo: integer().notNull().default(11),
  avatarMotion: text().notNull().default(''),
  avatarMotionType: text().notNull().default(''),
  updated: integer().notNull(),
});

// Linking requires proof from both the signed-in website and the private bot chat.
export const telegramChallenges = sqliteTable('telegram_challenges', {
  id: text().primaryKey(),
  userId: text()
    .notNull()
    .unique()
    .references(() => users.id),
  tokenHash: text().notNull().unique(),
  telegramId: text(),
  telegramName: text(),
  telegramUsername: text(),
  codeHash: text(),
  attempts: integer().notNull().default(0),
  created: integer().notNull(),
  expiresAt: integer().notNull(),
});
export const telegramLinks = sqliteTable('telegram_links', {
  id: text().primaryKey(),
  userId: text()
    .notNull()
    .unique()
    .references(() => users.id),
  telegramId: text().notNull().unique(),
  telegramName: text().notNull(),
  telegramUsername: text().notNull(),
  created: integer().notNull(),
});
// Test receipts are separate from any future real Telegram payment ledger.
export const telegramTopups = sqliteTable(
  'telegram_topups',
  {
    id: text().primaryKey(),
    requestKey: text().notNull().unique(),
    userId: text()
      .notNull()
      .references(() => users.id),
    telegramId: text().notNull(),
    linkId: text().notNull(),
    amount: integer().notNull(),
    status: text().notNull().default('pending'),
    created: integer().notNull(),
    expiresAt: integer().notNull(),
    creditedAt: integer(),
  },
  (t) => [
    index('telegram_topups_user').on(t.userId, t.created),
    index('telegram_topups_sender').on(t.telegramId, t.created),
  ],
);
