-- Artificial rankings only for work/music-qa. Never apply to a deployed database.
WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<35)
INSERT OR IGNORE INTO users(id,name,created) SELECT 'chart_qa_'||printf('%02d',x),'Chart fixture '||x,1 FROM n;
INSERT OR IGNORE INTO users(id,name,created) VALUES('zz_chart_qa_me','Chart fixture beyond top 30',1),('chart_qa_period','Chart fixture periods',1);
INSERT OR IGNORE INTO handles(handle,userId,main) SELECT id,id,1 FROM users WHERE id LIKE 'chart_qa_%' OR id='zz_chart_qa_me';
INSERT OR REPLACE INTO music_preferences(userId,participate) SELECT id,1 FROM users WHERE id LIKE 'chart_qa_%' OR id='zz_chart_qa_me';
INSERT OR IGNORE INTO music_tracks(id,url,kind,provider,title,artist,artwork,authorUrl,created)
VALUES('chart_qa_today','https://soundcloud.com/chart-qa/today','track','soundcloud','Today fixture','Chart QA','','https://soundcloud.com/chart-qa',1),
('chart_qa_2d','https://soundcloud.com/chart-qa/two-days','track','soundcloud','2 day fixture','Chart QA','','https://soundcloud.com/chart-qa',1),
('chart_qa_10d','https://soundcloud.com/chart-qa/ten-days','track','soundcloud','10 day fixture','Chart QA','','https://soundcloud.com/chart-qa',1),
('chart_qa_40d','https://soundcloud.com/chart-qa/forty-days','track','soundcloud','40 day fixture','Chart QA','','https://soundcloud.com/chart-qa',1);
DELETE FROM music_listens WHERE userId LIKE 'chart_qa_%' OR userId='zz_chart_qa_me';
INSERT INTO music_listens(userId,trackId,day,created) SELECT id,'chart_qa_today',CAST(strftime('%s','now') AS INTEGER)/86400,strftime('%s','now')*1000 FROM users WHERE id GLOB 'chart_qa_[0-9][0-9]' OR id='zz_chart_qa_me';
INSERT INTO music_listens(userId,trackId,day,created) VALUES
('chart_qa_period','chart_qa_2d',CAST(strftime('%s','now','-2 days') AS INTEGER)/86400,strftime('%s','now','-2 days')*1000),
('chart_qa_period','chart_qa_10d',CAST(strftime('%s','now','-10 days') AS INTEGER)/86400,strftime('%s','now','-10 days')*1000),
('chart_qa_period','chart_qa_40d',CAST(strftime('%s','now','-40 days') AS INTEGER)/86400,strftime('%s','now','-40 days')*1000);

UPDATE music_preferences SET participate=0 WHERE userId='zz_chart_qa_me';
