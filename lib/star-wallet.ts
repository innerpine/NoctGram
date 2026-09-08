import { db } from './storage';

export async function ensureWallet(me: string) {
  await db()
    .prepare(
      "INSERT OR IGNORE INTO star_transfers(id,recipient,amount,kind,created) VALUES(?,?,10000,'grant',?)",
    )
    .bind('grant:' + me, me, Date.now())
    .run();
}
export async function balance(me: string) {
  const row = await db()
    .prepare(
      'SELECT COALESCE(SUM(CASE WHEN recipient=? THEN amount ELSE -amount END),0) AS balance FROM star_transfers WHERE recipient=? OR sender=?',
    )
    .bind(me, me, me)
    .first<{ balance: number }>();
  return row?.balance || 0;
}
