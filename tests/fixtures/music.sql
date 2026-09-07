-- Artificial records for the isolated local music-qa database only.
INSERT OR IGNORE INTO music_tracks(id,url,kind,provider,title,artist,artwork,authorUrl,created) VALUES('music_qa_track','https://soundcloud.com/noctgram-qa/test-track','track','soundcloud','QA track (fixture)','QA artist','','https://soundcloud.com/noctgram-qa',1);
INSERT OR IGNORE INTO users(id,name,created) VALUES('music_qa_admin','Music QA moderator',1),('music_qa_blocked','Music QA blocked',1),('music_qa_readonly','Music QA read-only',1);
INSERT OR IGNORE INTO handles(handle,userId,main) VALUES('music_qa_admin','music_qa_admin',1),('music_qa_blocked','music_qa_blocked',1),('music_qa_readonly','music_qa_readonly',1);
INSERT OR IGNORE INTO moderation_events(id,userId,moderatorId,mode,reason,expiresAt,created) VALUES('music_qa_block','music_qa_blocked','music_qa_admin','blocked','Test fixture',NULL,1),('music_qa_read','music_qa_readonly','music_qa_admin','read_only','Test fixture',NULL,1);
INSERT OR REPLACE INTO account_restrictions(userId,eventId,mode,reason,expiresAt,created) VALUES('music_qa_blocked','music_qa_block','blocked','Test fixture',NULL,1),('music_qa_readonly','music_qa_read','read_only','Test fixture',NULL,1);
INSERT OR REPLACE INTO music_preferences(userId,participate) VALUES('music_qa_readonly',1);

-- Legacy opt-out must not disable the new automatic listening policy.
INSERT OR IGNORE INTO users(id,name,created) VALUES('music_qa_legacy','Legacy music fixture',1);
INSERT OR IGNORE INTO handles(handle,userId,main) VALUES('music_qa_legacy','music_qa_legacy',1);
INSERT OR REPLACE INTO music_preferences(userId,participate) VALUES('music_qa_legacy',0);
