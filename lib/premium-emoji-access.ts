import { db } from './storage';
import { ApiError } from './api-error';
import { entitlementActive } from './premium-predicate';
import { emojiParts, hasPremiumEmoji } from './premium-emoji';
export async function assertPremiumEmoji(me: string, text: string) {
  if (!hasPremiumEmoji(text)) return;
  const parts = emojiParts(text),
    tokens = parts.filter(
      (p) => p.text.startsWith(':noct_') || p.text.startsWith(':ce_'),
    );
  if (tokens.length > 30 || tokens.some((p) => !p.emoji && !p.custom))
    throw new ApiError(
      400,
      'В одном сообщении можно отправить до 30 эмодзи из набора NoctGram',
    );
  // Emoji from packs made by people must come from a live emoji pack.
  const custom = [...new Set(tokens.flatMap((p) => p.custom ?? []))];
  if (custom.length) {
    const found = await db()
      .prepare(
        `SELECT COUNT(*) AS count FROM stickers st JOIN sticker_packs sp ON sp.id=st.packId
        WHERE st.id IN(SELECT value FROM json_each(?)) AND st.deletedAt=0 AND sp.type='emoji' AND sp.deletedAt=0 AND sp.removedAt=0`,
      )
      .bind(JSON.stringify(custom))
      .first<{ count: number }>();
    if ((found?.count ?? 0) !== custom.length)
      throw new ApiError(404, 'Некоторые эмодзи удалены из своих наборов');
  }
  if (
    !(await db()
      .prepare(`SELECT 1 WHERE ${entitlementActive('?')}`)
      .bind(me, me)
      .first())
  )
    throw new ApiError(403, 'Для отправки этих эмодзи нужен Noct Premium');
}
