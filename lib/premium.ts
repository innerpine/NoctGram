import { db, bucket, clean, ApiError, profile } from './server';
import { setting } from './auth-session';
import {
  assertReadable,
  assertWritable,
  assertUploadAvailable,
} from './account-access';
import { activeActor, requireChannel } from './channel-access';
import {
  channelLevel,
  channelCanAct,
  boostChannelActive,
} from './boost-access';
import { premiumActive, appearanceColumns } from './premium-access';
import { assertMediaRead, mediaPermission } from './media-access';
import { assertStaticAvatar } from './avatar-media';
import { profileThemes, ringCharacters, chromeTempo } from './appearance';
export async function premiumGet(
  action: string,
  me: string,
): Promise<Response | null> {
  if (action !== 'premium') return null;
  await assertReadable(me);
  const state = await db()
    .prepare(`SELECT ${appearanceColumns('u')} FROM users u WHERE u.id=?`)
    .bind(me)
    .first();
  const entitlement = await db()
    .prepare(
      'SELECT expiresAt,source,revokedAt FROM premium_entitlements WHERE userId=?',
    )
    .bind(me)
    .first();
  return Response.json({
    ...state,
    expiresAt: state?.premium ? entitlement?.expiresAt : null,
    testMode: setting('NOCT_PREMIUM_TEST_MODE') === '1',
  });
}
export async function premiumPost(
  action: string,
  b: Record<string, unknown>,
  me: string,
): Promise<Response | null> {
  if (!['activatePremiumTest', 'appearance'].includes(action)) return null;
  await assertWritable(me);
  const d = db(),
    now = Date.now();
  if (action === 'activatePremiumTest') {
    if (setting('NOCT_PREMIUM_TEST_MODE') !== '1')
      throw new ApiError(403, 'Тестовая активация недоступна');
    await d
      .prepare(
        `INSERT INTO premium_entitlements(userId,startsAt,expiresAt,source,created) SELECT id,?,?,'test',? FROM users WHERE id=? AND kind='person' AND ${activeActor()} ON CONFLICT(userId) DO NOTHING`,
      )
      .bind(Math.floor(now / 1000) * 1000, now + 30 * 86400000, now, me, me)
      .run();
    if (
      !(await d
        .prepare(
          `SELECT id FROM users u WHERE id=? AND ${premiumActive('u.id')}`,
        )
        .bind(me)
        .first())
    )
      throw new ApiError(409, 'Тестовый период уже использован');
    return Response.json(await profile(me, me));
  }
  const target = b.id ? clean(b.id, 200, true) : me;
  const isChannel = target !== me;
  let level = 5;
  if (isChannel) {
    await requireChannel(target, me, 'profile');
    const channel = await d
      .prepare(
        `SELECT ${channelLevel('u')} AS level FROM users u WHERE u.id=? AND u.kind='channel'`,
      )
      .bind(target)
      .first<{ level: number }>();
    if (!channel || channel.level < 1)
      throw new ApiError(
        403,
        'Оформление канала открывается с 1 уровня бустов',
      );
    level = channel.level;
  }
  const theme = clean(b.theme, 20, true);
  let ringText = clean(b.ringText || '', 400).normalize('NFC');
  if (
    !Object.hasOwn(profileThemes, theme) ||
    typeof b.nameGradient !== 'boolean' ||
    ringCharacters(ringText).length > 48 ||
    /[\p{Cc}\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(
      ringText,
    )
  )
    throw new ApiError(400, 'Проверь оформление: текст обводки до 48 символов');
  const current = await d
    .prepare(
      'SELECT nameGradient,ringText,avatarMotion,avatarMotionType,chromeFlow,chromeTempo FROM profile_appearance WHERE userId=?',
    )
    .bind(target)
    .first<{
      avatarMotion: string;
      avatarMotionType: string;
      chromeFlow: number;
      chromeTempo: number;
      nameGradient: number;
      ringText: string;
    }>();
  // Older clients omit Chrome fields. Keep existing preferences on those saves.
  let chrome =
    b.chromeFlow === undefined ? !!current?.chromeFlow : b.chromeFlow;
  let tempo =
    b.chromeTempo === undefined
      ? (current?.chromeTempo ?? chromeTempo.default)
      : b.chromeTempo;
  if (
    typeof chrome !== 'boolean' ||
    typeof tempo !== 'number' ||
    !Number.isInteger(tempo) ||
    tempo < chromeTempo.min ||
    tempo > chromeTempo.max
  )
    throw new ApiError(400, 'Проверь Chrome Flow: темп от 3 до 26 секунд');
  let gradient = b.nameGradient;
  let motion = clean(b.avatarMotion || '', 200);
  const poster = clean(b.poster || '', 200);
  if (isChannel) {
    if (
      (level < 2 && gradient && !current?.nameGradient) ||
      (level < 3 && chrome && !current?.chromeFlow) ||
      (level < 4 && ringText && ringText !== current?.ringText) ||
      (level < 5 && ((motion && motion !== current?.avatarMotion) || poster))
    )
      throw new ApiError(
        403,
        'Для этой настройки нужен более высокий уровень канала',
      );
    // Locked choices are retained so lost boosts never erase the channel design.
    if (level < 2) gradient = !!current?.nameGradient;
    if (level < 3) {
      chrome = !!current?.chromeFlow;
      tempo = current?.chromeTempo ?? chromeTempo.default;
    }
    if (level < 4) ringText = current?.ringText || '';
    if (level < 5) motion = current?.avatarMotion || '';
  }
  const requiredLevel = Math.max(
    1,
    gradient && gradient !== !!current?.nameGradient ? 2 : 1,
    chrome &&
      (chrome !== !!current?.chromeFlow || tempo !== current?.chromeTempo)
      ? 3
      : 1,
    ringText && ringText !== current?.ringText ? 4 : 1,
    (motion && motion !== current?.avatarMotion) || poster ? 5 : 1,
  );
  let type =
    isChannel && motion === current?.avatarMotion
      ? current.avatarMotionType
      : '';
  if (motion && !(isChannel && motion === current?.avatarMotion)) {
    if (!/^\/api\/media\/[a-zA-Z0-9_-]+$/.test(motion))
      throw new ApiError(400, 'Неверный аватар');
    const id = motion.slice(11),
      up = await d
        .prepare('SELECT type FROM uploads WHERE id=? AND userId=?')
        .bind(id, me)
        .first<{ type: string }>();
    if (!up || !['image/gif', 'video/mp4', 'video/webm'].includes(up.type))
      throw new ApiError(400, 'Выбери GIF, MP4 или WebM');
    const head = await bucket().head(id);
    if (!head || head.size > 10 * 1024 * 1024)
      throw new ApiError(400, 'Анимированный аватар — до 10 МБ');
    await assertUploadAvailable(id);
    await assertMediaRead(id, me, me);
    type = up.type;
    if (motion !== current?.avatarMotion && !poster)
      throw new ApiError(400, 'Добавь неподвижное превью аватара');
  }
  if (poster) {
    if (!/^\/api\/media\/[a-zA-Z0-9_-]+$/.test(poster))
      throw new ApiError(400, 'Неверное превью');
    const id = poster.slice(11),
      up = await d
        .prepare(
          "SELECT id FROM uploads WHERE id=? AND userId=? AND type IN('image/png','image/jpeg','image/webp')",
        )
        .bind(id, me)
        .first();
    if (!up) throw new ApiError(400, 'Превью не найдено');
    await assertUploadAvailable(id);
    await assertMediaRead(id, me, me);
    await assertStaticAvatar(poster);
  }
  const input = `WITH input AS(SELECT ? AS actor,? AS target,? AS motion,? AS poster,? AS requiredLevel),eligible AS(SELECT u.id FROM users u,input i WHERE u.id=i.target
    AND ((u.id=i.actor AND u.kind='person' AND ${premiumActive('u.id')}) OR (${boostChannelActive('u')} AND ${channelCanAct('u', 'i.actor', true)} AND ${channelLevel('u')}>=i.requiredLevel))
    AND NOT EXISTS(SELECT 1 FROM account_restrictions ar WHERE ar.userId=i.actor AND (ar.expiresAt IS NULL OR ar.expiresAt>strftime('%s','now')*1000))
    AND (i.motion='' OR (u.kind='channel' AND i.motion=(SELECT pa.avatarMotion FROM profile_appearance pa WHERE pa.userId=u.id)) OR EXISTS(SELECT 1 FROM uploads up WHERE '/api/media/'||up.id=i.motion AND up.userId=i.actor AND ${mediaPermission('up.id', 'i.actor')}))
    AND (i.poster='' OR EXISTS(SELECT 1 FROM uploads up WHERE '/api/media/'||up.id=i.poster AND up.userId=i.actor AND ${mediaPermission('up.id', 'i.actor')})))`;
  const result = await d.batch([
    d
      .prepare(
        `${input} INSERT INTO profile_appearance(userId,theme,nameGradient,ringText,chromeFlow,chromeTempo,avatarMotion,avatarMotionType,updated) SELECT id,?,?,?,?,?,?,?,? FROM eligible WHERE 1 ON CONFLICT(userId) DO UPDATE SET theme=excluded.theme,nameGradient=excluded.nameGradient,ringText=excluded.ringText,chromeFlow=excluded.chromeFlow,chromeTempo=excluded.chromeTempo,avatarMotion=excluded.avatarMotion,avatarMotionType=excluded.avatarMotionType,updated=excluded.updated`,
      )
      .bind(
        me,
        target,
        motion,
        poster,
        requiredLevel,
        theme,
        gradient ? 1 : 0,
        ringText,
        chrome ? 1 : 0,
        tempo,
        motion,
        type,
        now,
      ),
    d
      .prepare(
        `${input} UPDATE users SET avatar=? WHERE id IN(SELECT id FROM eligible) AND ?<>''`,
      )
      .bind(me, target, motion, poster, requiredLevel, poster, poster),
  ]);
  if (!result[0].meta.changes)
    throw new ApiError(
      403,
      isChannel
        ? 'Уровень или права в канале изменились. Обнови профиль.'
        : 'Для сохранения нужен действующий Noct Premium и доступ к вложениям',
    );
  return Response.json(await profile(target, me));
}
