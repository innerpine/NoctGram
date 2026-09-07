-- Isolated QA database only. Apply before each auth.integration.mjs run.
-- Reset only the email binding of the fixed QA moderator, never a real account.
DELETE FROM auth_identities WHERE userId='mod_qa_admin';
DELETE FROM auth_sessions WHERE userId='mod_qa_admin';
INSERT OR IGNORE INTO users(id,name,created,onboardingComplete) VALUES('auth_qa_account','Auth QA',1,1);
INSERT OR IGNORE INTO handles(handle,userId,main) VALUES('qa_auth_account','auth_qa_account',1);
INSERT OR REPLACE INTO auth_sessions(tokenHash,userId,created,expiresAt) VALUES('ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb','auth_qa_account',0,1);
INSERT OR REPLACE INTO auth_challenges(tokenHash,email,created,expiresAt) VALUES('a0fab1377f49a759b57f63318262ebe89fabfc990e8e93ceac2984561482b9d4','expired@example.com',0,1);
INSERT OR IGNORE INTO users(id,name,created,onboardingComplete) VALUES('auth_qa_pending','Pending QA',1,0);
INSERT OR IGNORE INTO handles(handle,userId,main) VALUES('qa_auth_pending','auth_qa_pending',1);
