// The existing bot handler uses synchronous storage. Durable Object SQLite
// keeps the same contract without a local process or a Node filesystem.
export class CloudflareBotStore {
  constructor(sql) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS updates(id INTEGER PRIMARY KEY,payload TEXT NOT NULL,retryAt INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS completed(id INTEGER PRIMARY KEY,at INTEGER NOT NULL);`);
  }
  get(key) {
    const row = this.sql
      .exec('SELECT value FROM state WHERE key=?', key)
      .toArray()[0];
    return row ? JSON.parse(row.value) : null;
  }
  set(key, value) {
    // Null outbox values have no meaning to the shared bot; avoid accumulating
    // empty rows while retaining receipt and delivery deduplication markers.
    if (value === null) this.sql.exec('DELETE FROM state WHERE key=?', key);
    else
      this.sql.exec(
        'INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        key,
        JSON.stringify(value),
      );
  }
  entries(prefix) {
    return this.sql
      .exec('SELECT key,value FROM state WHERE key LIKE ?', prefix + '%')
      .toArray()
      .map((r) => ({ key: r.key, value: JSON.parse(r.value) }));
  }
  enqueue(update) {
    this.sql.exec(
      'INSERT INTO updates(id,payload) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM completed WHERE id=?) ON CONFLICT DO NOTHING',
      update.update_id,
      JSON.stringify(update),
      update.update_id,
    );
  }
  pending() {
    return this.sql
      .exec(
        'SELECT payload FROM updates WHERE retryAt<=? ORDER BY id LIMIT 10',
        Date.now(),
      )
      .toArray()
      .map((r) => JSON.parse(r.payload));
  }
  complete(id) {
    this.sql.exec(
      'INSERT INTO completed(id,at) VALUES(?,?) ON CONFLICT DO NOTHING',
      id,
      Date.now(),
    );
    this.sql.exec('DELETE FROM updates WHERE id=?', id);
  }
  retry(id) {
    const attempts =
      this.sql.exec('SELECT attempts FROM updates WHERE id=?', id).toArray()[0]
        ?.attempts || 0;
    this.sql.exec(
      'UPDATE updates SET attempts=attempts+1,retryAt=? WHERE id=?',
      Date.now() + Math.min(300000, 15000 * 2 ** Math.min(attempts, 5)),
      id,
    );
  }
  nextRetry() {
    return (
      this.sql.exec('SELECT MIN(retryAt) AS at FROM updates').toArray()[0]
        ?.at ?? null
    );
  }
  cleanup() {
    // Telegram retains updates for at most 24 hours. Keep completed IDs longer;
    // financial receipt deduplication in state and website D1 is never removed.
    this.sql.exec(
      'DELETE FROM completed WHERE at<?',
      Date.now() - 14 * 86400000,
    );
  }
  diagnostics() {
    const count = this.sql
      .exec('SELECT COUNT(*) AS count FROM updates')
      .toArray()[0].count;
    return {
      queuedUpdates: count,
      paymentReviews: this.sql
        .exec(
          "SELECT COUNT(*) AS count FROM state WHERE key LIKE 'payment-review:%'",
        )
        .toArray()[0].count,
      pendingReceipts: this.sql
        .exec(
          "SELECT COUNT(*) AS count FROM state WHERE key LIKE 'pending-payment:%'",
        )
        .toArray()[0].count,
      lastHandledAt: this.get('lastHandledAt'),
      lastPaymentReconcileAt: this.get('lastPaymentReconcileAt'),
      lastReconcileError: this.get('lastReconcileError'),
    };
  }
}
