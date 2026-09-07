INSERT OR IGNORE INTO users(id,name,created) VALUES('mod_qa_admin','QA Moderator',1);
INSERT OR IGNORE INTO handles(handle,userId,main) VALUES('qa_moderator','mod_qa_admin',1);
INSERT OR IGNORE INTO moderators(userId,created) VALUES('mod_qa_admin',1);
INSERT OR IGNORE INTO users(id,name,created) VALUES('mod_qa_expired','Expired fixture',1);
INSERT OR IGNORE INTO handles(handle,userId,main) VALUES('qa_expired','mod_qa_expired',1);
INSERT OR IGNORE INTO moderation_events(id,userId,moderatorId,mode,reason,expiresAt,created) VALUES('qa_expired_event','mod_qa_expired','mod_qa_admin','blocked','Expired restriction',1000,1);
INSERT OR REPLACE INTO account_restrictions(userId,eventId,mode,reason,expiresAt,created) VALUES('mod_qa_expired','qa_expired_event','blocked','Expired restriction',1000,1);
