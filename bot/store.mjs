import { DatabaseSync } from 'node:sqlite';
export class BotStore {
  constructor(filename, botId) {
    this.db = new DatabaseSync(filename);
    this.botId = String(botId);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (bot TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(bot,key))',
    );
  }
  get(key) {
    const row = this.db
      .prepare('SELECT value FROM state WHERE bot=? AND key=?')
      .get(this.botId, key);
    return row ? JSON.parse(row.value) : null;
  }
  set(key, value) {
    this.db
      .prepare(
        'INSERT INTO state(bot,key,value) VALUES(?,?,?) ON CONFLICT(bot,key) DO UPDATE SET value=excluded.value',
      )
      .run(this.botId, key, JSON.stringify(value));
  }
  close() {
    this.db.close();
  }
}
