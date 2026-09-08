CREATE TABLE `account_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`sessionHash` text NOT NULL,
	`userId` text NOT NULL,
	`purpose` text NOT NULL,
	`subject` text NOT NULL,
	`email` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `account_challenges_session` ON `account_challenges` (`sessionHash`);--> statement-breakpoint
CREATE INDEX `account_challenges_expiry` ON `account_challenges` (`expiresAt`);--> statement-breakpoint
CREATE TABLE `account_deletions` (
	`userId` text PRIMARY KEY NOT NULL,
	`requestId` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_deletions_requestId_unique` ON `account_deletions` (`requestId`);--> statement-breakpoint
CREATE TABLE `admin_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actorId` text NOT NULL,
	`targetId` text NOT NULL,
	`action` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`targetId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `admin_events_created` ON `admin_events` (`created`);--> statement-breakpoint
CREATE TABLE `administrators` (
	`userId` text PRIMARY KEY NOT NULL,
	`created` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recovery_codes` (
	`hash` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`created` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recovery_codes_user` ON `recovery_codes` (`userId`);--> statement-breakpoint
CREATE TABLE `storage_deletions` (
	`objectKey` text PRIMARY KEY NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `verifiedAt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `uploads` ADD `bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `uploads` ADD `state` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `verified` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `deletedAt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `sessionsRevokedAt` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Account integrity guards (kept in the migration, alongside the schema).
INSERT OR IGNORE INTO administrators(userId,created) SELECT id,strftime('%s','now')*1000 FROM users WHERE id='local_seedy' AND deletedAt=0;
--> statement-breakpoint
UPDATE users SET verified=1 WHERE id='noctgram';
--> statement-breakpoint
CREATE INDEX uploads_owner_state ON uploads(userId,state,created);
--> statement-breakpoint
CREATE INDEX uploads_cleanup ON uploads(state,created);
--> statement-breakpoint
CREATE TRIGGER users_media_ready_insert BEFORE INSERT ON users WHEN (NEW.avatar LIKE '/api/media/%' AND NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=substr(NEW.avatar,12) AND up.state='ready')) OR (NEW.cover LIKE '/api/media/%' AND NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=substr(NEW.cover,12) AND up.state='ready')) BEGIN SELECT RAISE(ABORT,'MEDIA_NOT_READY'); END;
--> statement-breakpoint
CREATE TRIGGER users_media_ready_update BEFORE UPDATE OF avatar,cover ON users WHEN (NEW.avatar<>OLD.avatar AND NEW.avatar LIKE '/api/media/%' AND NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=substr(NEW.avatar,12) AND up.state='ready')) OR (NEW.cover<>OLD.cover AND NEW.cover LIKE '/api/media/%' AND NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=substr(NEW.cover,12) AND up.state='ready')) BEGIN SELECT RAISE(ABORT,'MEDIA_NOT_READY'); END;
--> statement-breakpoint
CREATE TRIGGER profile_appearance_media_ready_insert BEFORE INSERT ON profile_appearance WHEN NEW.avatarMotion LIKE '/api/media/%' AND NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=substr(NEW.avatarMotion,12) AND up.state='ready') BEGIN SELECT RAISE(ABORT,'MEDIA_NOT_READY'); END;
--> statement-breakpoint
CREATE TRIGGER profile_appearance_media_ready_update BEFORE UPDATE OF avatarMotion ON profile_appearance WHEN NEW.avatarMotion<>OLD.avatarMotion AND NEW.avatarMotion LIKE '/api/media/%' AND NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=substr(NEW.avatarMotion,12) AND up.state='ready') BEGIN SELECT RAISE(ABORT,'MEDIA_NOT_READY'); END;
--> statement-breakpoint
CREATE TRIGGER posts_media_ready_insert BEFORE INSERT ON posts WHEN EXISTS(SELECT 1 FROM json_each(NEW.media) m WHERE NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=json_extract(m.value,'$.id') AND up.state='ready')) BEGIN SELECT RAISE(ABORT,'MEDIA_NOT_READY'); END;
--> statement-breakpoint
CREATE TRIGGER posts_media_ready_update BEFORE UPDATE OF media ON posts WHEN NEW.media<>OLD.media AND EXISTS(SELECT 1 FROM json_each(NEW.media) m WHERE NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=json_extract(m.value,'$.id') AND up.state='ready')) BEGIN SELECT RAISE(ABORT,'MEDIA_NOT_READY'); END;
--> statement-breakpoint
CREATE TRIGGER stories_media_ready_insert BEFORE INSERT ON stories WHEN NEW.mediaId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=NEW.mediaId AND up.state='ready') BEGIN SELECT RAISE(ABORT,'MEDIA_NOT_READY'); END;
--> statement-breakpoint
CREATE TRIGGER stories_media_ready_update BEFORE UPDATE OF mediaId ON stories WHEN NEW.mediaId IS NOT OLD.mediaId AND NEW.mediaId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=NEW.mediaId AND up.state='ready') BEGIN SELECT RAISE(ABORT,'MEDIA_NOT_READY'); END;
--> statement-breakpoint
CREATE TRIGGER moderated_uploads_media_ready_insert BEFORE INSERT ON moderated_uploads WHEN NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=NEW.uploadId AND up.state='ready') BEGIN SELECT RAISE(ABORT,'MEDIA_NOT_READY'); END;
--> statement-breakpoint
CREATE TRIGGER moderated_uploads_media_ready_update BEFORE UPDATE ON moderated_uploads WHEN NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=NEW.uploadId AND up.state='ready') BEGIN SELECT RAISE(ABORT,'MEDIA_NOT_READY'); END;
--> statement-breakpoint
CREATE TRIGGER content_reports_media_ready_insert BEFORE INSERT ON content_reports WHEN (json_extract(NEW.snapshot,'$.mediaId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=json_extract(NEW.snapshot,'$.mediaId') AND up.state='ready')) OR EXISTS(SELECT 1 FROM json_each(json_extract(NEW.snapshot,'$.media')) m WHERE NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=json_extract(m.value,'$.id') AND up.state='ready')) BEGIN SELECT RAISE(ABORT,'MEDIA_NOT_READY'); END;
--> statement-breakpoint
CREATE TRIGGER content_reports_media_ready_update BEFORE UPDATE OF snapshot ON content_reports WHEN NEW.snapshot<>OLD.snapshot AND ((json_extract(NEW.snapshot,'$.mediaId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=json_extract(NEW.snapshot,'$.mediaId') AND up.state='ready')) OR EXISTS(SELECT 1 FROM json_each(json_extract(NEW.snapshot,'$.media')) m WHERE NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=json_extract(m.value,'$.id') AND up.state='ready'))) BEGIN SELECT RAISE(ABORT,'MEDIA_NOT_READY'); END;
--> statement-breakpoint
CREATE TRIGGER content_removals_media_ready_insert BEFORE INSERT ON content_removals WHEN (json_extract(NEW.snapshot,'$.mediaId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=json_extract(NEW.snapshot,'$.mediaId') AND up.state='ready')) OR EXISTS(SELECT 1 FROM json_each(json_extract(NEW.snapshot,'$.media')) m WHERE NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=json_extract(m.value,'$.id') AND up.state='ready')) BEGIN SELECT RAISE(ABORT,'MEDIA_NOT_READY'); END;
--> statement-breakpoint
CREATE TRIGGER content_removals_media_ready_update BEFORE UPDATE OF snapshot ON content_removals WHEN NEW.snapshot<>OLD.snapshot AND ((json_extract(NEW.snapshot,'$.mediaId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=json_extract(NEW.snapshot,'$.mediaId') AND up.state='ready')) OR EXISTS(SELECT 1 FROM json_each(json_extract(NEW.snapshot,'$.media')) m WHERE NOT EXISTS(SELECT 1 FROM uploads up WHERE up.id=json_extract(m.value,'$.id') AND up.state='ready'))) BEGIN SELECT RAISE(ABORT,'MEDIA_NOT_READY'); END;
--> statement-breakpoint
CREATE TRIGGER posts_active_user_insert BEFORE INSERT ON posts WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) OR EXISTS(SELECT 1 FROM users WHERE id=NEW.publisherId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER posts_active_user_update BEFORE UPDATE ON posts WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) OR EXISTS(SELECT 1 FROM users WHERE id=NEW.publisherId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER comments_active_user_insert BEFORE INSERT ON comments WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER comments_active_user_update BEFORE UPDATE ON comments WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER messages_active_user_insert BEFORE INSERT ON messages WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.sender AND deletedAt>0) OR EXISTS(SELECT 1 FROM users WHERE id=NEW.recipient AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER messages_active_user_update BEFORE UPDATE ON messages WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.sender AND deletedAt>0) OR EXISTS(SELECT 1 FROM users WHERE id=NEW.recipient AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER stories_active_user_insert BEFORE INSERT ON stories WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER stories_active_user_update BEFORE UPDATE ON stories WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER follows_active_user_insert BEFORE INSERT ON follows WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.follower AND deletedAt>0) OR EXISTS(SELECT 1 FROM users WHERE id=NEW.following AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER follows_active_user_update BEFORE UPDATE ON follows WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.follower AND deletedAt>0) OR EXISTS(SELECT 1 FROM users WHERE id=NEW.following AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER handles_active_user_insert BEFORE INSERT ON handles WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER handles_active_user_update BEFORE UPDATE ON handles WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER likes_active_user_insert BEFORE INSERT ON likes WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER likes_active_user_update BEFORE UPDATE ON likes WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER bookmarks_active_user_insert BEFORE INSERT ON bookmarks WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER bookmarks_active_user_update BEFORE UPDATE ON bookmarks WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER votes_active_user_insert BEFORE INSERT ON votes WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER votes_active_user_update BEFORE UPDATE ON votes WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER channel_members_active_user_insert BEFORE INSERT ON channel_members WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) OR EXISTS(SELECT 1 FROM users WHERE id=NEW.channelId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER channel_members_active_user_update BEFORE UPDATE ON channel_members WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) OR EXISTS(SELECT 1 FROM users WHERE id=NEW.channelId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER auth_sessions_active_user_insert BEFORE INSERT ON auth_sessions WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER auth_sessions_active_user_update BEFORE UPDATE ON auth_sessions WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER auth_identities_active_user_insert BEFORE INSERT ON auth_identities WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER auth_identities_active_user_update BEFORE UPDATE ON auth_identities WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER uploads_active_user_insert BEFORE INSERT ON uploads WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER uploads_active_user_update BEFORE UPDATE OF state ON uploads WHEN NEW.state='ready' AND EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER profile_appearance_active_user_insert BEFORE INSERT ON profile_appearance WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER profile_appearance_active_user_update BEFORE UPDATE ON profile_appearance WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER premium_entitlements_active_user_insert BEFORE INSERT ON premium_entitlements WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER premium_entitlements_active_user_update BEFORE UPDATE ON premium_entitlements WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER moderators_active_user_insert BEFORE INSERT ON moderators WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER moderators_active_user_update BEFORE UPDATE ON moderators WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER telegram_links_active_user_insert BEFORE INSERT ON telegram_links WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER telegram_links_active_user_update BEFORE UPDATE ON telegram_links WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER telegram_challenges_active_user_insert BEFORE INSERT ON telegram_challenges WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER telegram_challenges_active_user_update BEFORE UPDATE ON telegram_challenges WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER push_subscriptions_active_user_insert BEFORE INSERT ON push_subscriptions WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER push_subscriptions_active_user_update BEFORE UPDATE ON push_subscriptions WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER music_audio_active_user_insert BEFORE INSERT ON music_audio WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER music_audio_active_user_update BEFORE UPDATE ON music_audio WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER music_library_active_user_insert BEFORE INSERT ON music_library WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER music_library_active_user_update BEFORE UPDATE ON music_library WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER music_connections_active_user_insert BEFORE INSERT ON music_connections WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER music_connections_active_user_update BEFORE UPDATE ON music_connections WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER music_oauth_states_active_user_insert BEFORE INSERT ON music_oauth_states WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER music_oauth_states_active_user_update BEFORE UPDATE ON music_oauth_states WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER music_imports_active_user_insert BEFORE INSERT ON music_imports WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER music_imports_active_user_update BEFORE UPDATE ON music_imports WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER music_sessions_active_user_insert BEFORE INSERT ON music_sessions WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER music_sessions_active_user_update BEFORE UPDATE ON music_sessions WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.userId AND deletedAt>0) BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER users_active_owner_insert BEFORE INSERT ON users WHEN NEW.ownerId IS NOT NULL AND EXISTS(SELECT 1 FROM users WHERE id=NEW.ownerId AND deletedAt>0) AND NEW.deletedAt=0 BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER users_active_owner_update BEFORE UPDATE ON users WHEN NEW.ownerId IS NOT NULL AND EXISTS(SELECT 1 FROM users WHERE id=NEW.ownerId AND deletedAt>0) AND NEW.deletedAt=0 BEGIN SELECT RAISE(ABORT,'ACCOUNT_DELETED'); END;
--> statement-breakpoint
CREATE TRIGGER music_audio_quota_insert BEFORE INSERT ON music_audio WHEN (SELECT COALESCE(SUM(size),0) FROM music_audio WHERE userId=NEW.userId AND trackId<>NEW.trackId)+NEW.size>536870912 OR (SELECT COUNT(*) FROM music_audio WHERE userId=NEW.userId AND trackId<>NEW.trackId)>=500 BEGIN SELECT RAISE(ABORT,'STORAGE_QUOTA'); END;
--> statement-breakpoint
CREATE TRIGGER music_audio_quota_update BEFORE UPDATE ON music_audio WHEN (SELECT COALESCE(SUM(size),0) FROM music_audio WHERE userId=NEW.userId AND trackId<>NEW.trackId)+NEW.size>536870912 OR (SELECT COUNT(*) FROM music_audio WHERE userId=NEW.userId AND trackId<>NEW.trackId)>=500 BEGIN SELECT RAISE(ABORT,'STORAGE_QUOTA'); END;
