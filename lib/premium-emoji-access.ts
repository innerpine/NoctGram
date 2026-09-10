import { db } from './storage';
import { ApiError } from './api-error';
import { entitlementActive } from './premium-predicate';
import { emojiParts, hasPremiumEmoji } from './premium-emoji';
export async function assertPremiumEmoji(me: string, text: string) {
  if (!hasPremiumEmoji(text)) return;
  const parts = emojiParts(text),
    tokens = parts.filter((p) => p.text.startsWith(':noct_'));
  if (tokens.length > 30 || tokens.some((p) => !p.emoji))
    throw new ApiError(
      400,
      'В одном сообщении можно отправить до 30 эмодзи из набора NoctGram',
    );
  if (
    !(await db()
      .prepare(`SELECT 1 WHERE ${entitlementActive('?')}`)
      .bind(me, me)
      .first())
  )
    throw new ApiError(403, 'Для отправки этих эмодзи нужен Noct Premium');
}
