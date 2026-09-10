import { DatabaseSync } from 'node:sqlite';
export class BotStore {
  constructor(filename, botId) {
    this.db = new DatabaseSync(filename);
    this.botId = String(botId);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (bot TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(bot,key))',
    );
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS updates(bot TEXT NOT NULL,id INTEGER NOT NULL,payload TEXT NOT NULL,retryAt INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(bot,id))',
    );
  }
  enqueue(update) {
    this.db
      .prepare(
        'INSERT INTO updates(bot,id,payload) VALUES(?,?,?) ON CONFLICT DO NOTHING',
      )
      .run(this.botId, update.update_id, JSON.stringify(update));
  }
  pending() {
    return this.db
      .prepare(
        'SELECT id,payload FROM updates WHERE bot=? AND retryAt<=? ORDER BY id LIMIT 10',
      )
      .all(this.botId, Date.now())
      .map((r) => JSON.parse(r.payload));
  }
  complete(id) {
    this.db
      .prepare('DELETE FROM updates WHERE bot=? AND id=?')
      .run(this.botId, id);
  }
  retry(id) {
    this.db
      .prepare('UPDATE updates SET retryAt=? WHERE bot=? AND id=?')
      .run(Date.now() + 15000, this.botId, id);
  }
  entries(prefix) {
    return this.db
      .prepare('SELECT key,value FROM state WHERE bot=? AND key LIKE ?')
      .all(this.botId, prefix + '%')
      .map((r) => ({ key: r.key, value: JSON.parse(r.value) }));
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
