// Sticker and custom emoji packs. Built-in packs come from the catalog; people
// make their own packs from WebP, PNG and TGS files, checked here before they
// reach storage. A live sticker is visible to every signed-in account.
import { db, bucket } from './storage';
import { ApiError } from './api-error';
import { assertReadable, assertWritable } from './account-access';
import { premiumActive } from './premium-access';
import { reserveUpload, uploadReferenced } from './upload-storage';
import {
  builtinInfo,
  builtinItem,
  builtinPack,
  builtinPackInfo,
  builtinSticker,
  stickerCatalog,
} from './sticker-catalog';
import {
  EMOJI_IMAGE_LIMIT,
  EMOJI_PER_PACK,
  FAVE_LIMIT,
  FAVE_PREMIUM_LIMIT,
  PACK_TITLE_LIMIT,
  SHORT_NAME_PATTERN,
  STICKER_IMAGE_LIMIT,
  STICKER_INSTALL_LIMIT,
  STICKER_PACK_LIMIT,
  STICKERS_PER_PACK,
  customEmojiToken,
  type StickerInfo,
  type StickerPackInfo,
  type StickerPanel,
} from './sticker-types';
import {
  StickerFileError,
  TGS_LIMIT,
  imageSize,
  inflateTgs,
  inspectLottie,
} from './tgs-validate';
import { USER_STICKER_REF, livePack } from './sticker-send';

type PackType = 'stickers' | 'emoji';
type StickerRow = {
  id: string;
  packId: string;
  emoji: string;
  format: 'webp' | 'png' | 'tgs';
  uploadId: string;
  width: number;
  height: number;
  type: PackType;
  live: number;
};
type PackRow = {
  id: string;
  shortName: string;
  title: string;
  type: PackType;
  ownerId: string;
  removedAt: number;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PACK_REF = new RegExp('^u:(' + UUID.source.slice(1, -1) + ')$');
// Official-looking names stay free for built-in packs.
const RESERVED = /^(noct|telegram|tgweb|official|admin)/;
const stickerColumns = `st.id,st.packId,st.emoji,st.format,st.uploadId,st.width,st.height,sp.type`;
const formats = {
  png: { type: 'image/png', name: 'sticker.png' },
  webp: { type: 'image/webp', name: 'sticker.webp' },
  tgs: { type: 'application/x-tgsticker', name: 'sticker.tgs' },
} as const;

function userInfo(row: StickerRow): StickerInfo {
  const available = !!row.live;
  return {
    ref: 'u:' + row.id,
    packRef: 'u:' + row.packId,
    emoji: row.emoji,
    format: row.format,
    src: available ? '/api/media/' + row.uploadId : '',
    w: row.width,
    h: row.height,
    available,
    ...(row.type === 'emoji' ? { token: customEmojiToken(row.id) } : {}),
  };
}
function packInfo(
  pack: PackRow,
  stickers: StickerRow[],
  me: string,
  installed: boolean,
): StickerPackInfo {
  return {
    ref: 'u:' + pack.id,
    id: pack.id,
    shortName: pack.shortName,
    title: pack.title,
    type: pack.type,
    builtin: false,
    own: pack.ownerId === me,
    installed,
    ...(pack.ownerId === me && pack.removedAt ? { removed: true } : {}),
    // Files of a pack removed by a moderator are no longer served.
    stickers: stickers
      .filter((sticker) => sticker.packId === pack.id)
      .map((sticker) => userInfo({ ...sticker, live: pack.removedAt ? 0 : 1 })),
  };
}
function id(value: unknown, message = 'Набор не найден') {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new ApiError(404, message);
  return value;
}
async function premium(me: string) {
  const row = await db()
    .prepare(
      `SELECT ${premiumActive('u.id')} AS premium FROM users u WHERE u.id=?`,
    )
    .bind(me)
    .first<{ premium: number }>();
  return !!row?.premium;
}
async function packStickers(ids: string[]) {
  if (!ids.length) return [];
  return (
    await db()
      .prepare(
        `SELECT ${stickerColumns},1 AS live FROM stickers st JOIN sticker_packs sp ON sp.id=st.packId
        WHERE st.packId IN(SELECT value FROM json_each(?)) AND st.deletedAt=0 ORDER BY st.position,st.created,st.id`,
      )
      .bind(JSON.stringify(ids))
      .all<StickerRow>()
  ).results;
}

// Rendering info for message stickers and custom emoji, in request order.
// Missing and removed stickers come back unavailable, without a file.
export async function resolveStickers(refs: unknown): Promise<StickerInfo[]> {
  if (
    !Array.isArray(refs) ||
    refs.length > 60 ||
    refs.some((ref) => typeof ref !== 'string' || ref.length > 100)
  )
    throw new ApiError(400, 'Некорректный список стикеров');
  const unique = [...new Set(refs as string[])];
  const ids = unique.flatMap((ref) => USER_STICKER_REF.exec(ref)?.[1] ?? []);
  const rows = ids.length
    ? (
        await db()
          .prepare(
            `SELECT ${stickerColumns},(st.deletedAt=0 AND ${livePack}) AS live FROM stickers st
            JOIN sticker_packs sp ON sp.id=st.packId JOIN users o ON o.id=sp.ownerId
            WHERE st.id IN(SELECT value FROM json_each(?))`,
          )
          .bind(JSON.stringify(ids))
          .all<StickerRow>()
      ).results
    : [];
  return unique.map((ref) => {
    const found = builtinItem(ref);
    if (found) return builtinInfo(found.pack, found.item);
    const row = rows.find((item) => 'u:' + item.id === ref);
    if (row) return userInfo(row);
    return {
      ref,
      packRef: '',
      emoji: '',
      format: 'webp',
      src: '',
      w: 512,
      h: 512,
      available: false,
    };
  });
}

// The sticker panel: installed packs with their stickers, and favourites.
// Built-in packs are always there; the client has them in its catalog.
export async function stickerPanel(me: string): Promise<StickerPanel> {
  await assertReadable(me);
  const packs = (
    await db()
      .prepare(
        `SELECT sp.id,sp.shortName,sp.title,sp.type,sp.ownerId,sp.removedAt FROM user_sticker_packs usp
        JOIN sticker_packs sp ON sp.id=substr(usp.packRef,3) JOIN users o ON o.id=sp.ownerId
        WHERE usp.userId=? AND usp.packRef LIKE 'u:%' AND ${livePack}
        ORDER BY usp.position,usp.installedAt DESC LIMIT ${STICKER_INSTALL_LIMIT}`,
      )
      .bind(me)
      .all<PackRow>()
  ).results;
  const stickers = await packStickers(packs.map((pack) => pack.id));
  const extended = await premium(me);
  const limit = extended ? FAVE_PREMIUM_LIMIT : FAVE_LIMIT;
  const faved = (
    await db()
      .prepare(
        'SELECT stickerRef FROM faved_stickers WHERE userId=? ORDER BY created DESC LIMIT ?',
      )
      .bind(me, limit)
      .all<{ stickerRef: string }>()
  ).results.map((row) => row.stickerRef);
  return {
    packs: packs.map((pack) => packInfo(pack, stickers, me, true)),
    favorites: (await resolveStickers(faved)).filter(
      (sticker) => sticker.available,
    ),
    premium: extended,
    limits: {
      packs: STICKER_PACK_LIMIT,
      installed: STICKER_INSTALL_LIMIT,
      stickers: STICKERS_PER_PACK,
      emoji: EMOJI_PER_PACK,
      favorites: limit,
    },
  };
}

// One pack by its link name (or 'u:<id>'), for the preview dialog.
export async function readPack(me: string, name: unknown) {
  await assertReadable(me);
  if (typeof name !== 'string' || name.length > 64)
    throw new ApiError(404, 'Набор не найден');
  const builtin = builtinPack(name);
  if (builtin) return builtinPackInfo(builtin);
  const byId = PACK_REF.exec(name)?.[1];
  if (!byId && !SHORT_NAME_PATTERN.test(name))
    throw new ApiError(404, 'Набор не найден');
  const pack = await db()
    .prepare(
      `SELECT sp.id,sp.shortName,sp.title,sp.type,sp.ownerId,sp.removedAt,
      EXISTS(SELECT 1 FROM user_sticker_packs usp WHERE usp.userId=? AND usp.packRef='u:'||sp.id) AS installed
      FROM sticker_packs sp JOIN users o ON o.id=sp.ownerId WHERE ${byId ? 'sp.id=?' : 'sp.shortName=?'} AND ${livePack}`,
    )
    .bind(me, byId ?? name)
    .first<PackRow & { installed: number }>();
  if (!pack) throw new ApiError(404, 'Набор удалён или недоступен');
  return packInfo(pack, await packStickers([pack.id]), me, !!pack.installed);
}

// The owner's packs, including ones removed by a moderator.
export async function myPacks(me: string) {
  await assertReadable(me);
  const packs = (
    await db()
      .prepare(
        `SELECT sp.id,sp.shortName,sp.title,sp.type,sp.ownerId,sp.removedAt,
        EXISTS(SELECT 1 FROM user_sticker_packs usp WHERE usp.userId=sp.ownerId AND usp.packRef='u:'||sp.id) AS installed
        FROM sticker_packs sp WHERE sp.ownerId=? AND sp.deletedAt=0 ORDER BY sp.created DESC,sp.id`,
      )
      .bind(me)
      .all<PackRow & { installed: number }>()
  ).results;
  const stickers = await packStickers(packs.map((pack) => pack.id));
  return {
    packs: packs.map((pack) => packInfo(pack, stickers, me, !!pack.installed)),
    limit: STICKER_PACK_LIMIT,
  };
}

function packTitle(value: unknown) {
  const title =
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!title || title.length > PACK_TITLE_LIMIT)
    throw new ApiError(400, 'Название набора — от 1 до 64 символов');
  return title;
}
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
// Each sticker is found by one emoji, like in Telegram.
function stickerEmoji(value: unknown) {
  const emoji = typeof value === 'string' ? value.trim() : '';
  if (
    !emoji ||
    emoji.length > 16 ||
    [...segmenter.segment(emoji)].length !== 1 ||
    !/\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(emoji)
  )
    throw new ApiError(400, 'Выберите один эмодзи для стикера');
  return emoji;
}
export async function createPack(me: string, body: Record<string, unknown>) {
  await assertWritable(me);
  const title = packTitle(body.title);
  const shortName =
    typeof body.shortName === 'string'
      ? body.shortName.trim().toLowerCase()
      : '';
  if (!SHORT_NAME_PATTERN.test(shortName))
    throw new ApiError(
      400,
      'Короткое имя — от 5 до 32 латинских букв, цифр или «_»',
    );
  if (RESERVED.test(shortName) || builtinPack(shortName))
    throw new ApiError(409, 'Это короткое имя зарезервировано');
  const type: PackType = body.type === 'emoji' ? 'emoji' : 'stickers';
  if (
    body.type !== undefined &&
    body.type !== 'emoji' &&
    body.type !== 'stickers'
  )
    throw new ApiError(400, 'Выберите тип набора');
  const packId = crypto.randomUUID(),
    now = Date.now();
  const [created] = await db().batch([
    db()
      .prepare(
        `INSERT INTO sticker_packs(id,ownerId,type,shortName,title,created,updated)
        SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM sticker_packs WHERE ownerId=? AND deletedAt=0)<?
        AND NOT EXISTS(SELECT 1 FROM sticker_packs WHERE shortName=?)`,
      )
      .bind(
        packId,
        me,
        type,
        shortName,
        title,
        now,
        now,
        me,
        STICKER_PACK_LIMIT,
        shortName,
      ),
    // A new pack appears in its author's panel right away.
    db()
      .prepare(
        `INSERT INTO user_sticker_packs(userId,packRef,position,installedAt)
        SELECT ?,?,COALESCE((SELECT MIN(position)-1 FROM user_sticker_packs WHERE userId=?),0),?
        WHERE EXISTS(SELECT 1 FROM sticker_packs WHERE id=? AND ownerId=?)
        AND (SELECT COUNT(*) FROM user_sticker_packs WHERE userId=?)<? ON CONFLICT DO NOTHING`,
      )
      .bind(me, 'u:' + packId, me, now, packId, me, me, STICKER_INSTALL_LIMIT),
  ]);
  if (!created.meta.changes) {
    const taken = await db()
      .prepare('SELECT 1 FROM sticker_packs WHERE shortName=?')
      .bind(shortName)
      .first();
    throw new ApiError(
      taken ? 409 : 400,
      taken
        ? 'Это короткое имя уже занято'
        : `Можно создать до ${STICKER_PACK_LIMIT} наборов`,
    );
  }
  return readPack(me, 'u:' + packId);
}
async function ownPack(me: string, value: unknown) {
  const pack = await db()
    .prepare(
      'SELECT id,shortName,title,type,ownerId,removedAt FROM sticker_packs WHERE id=? AND ownerId=? AND deletedAt=0',
    )
    .bind(id(value), me)
    .first<PackRow>();
  if (!pack) throw new ApiError(404, 'Набор не найден');
  return pack;
}
function editable(pack: PackRow) {
  if (pack.removedAt)
    throw new ApiError(403, 'Набор удалён модератором и не редактируется');
  return pack;
}
export async function updatePack(me: string, body: Record<string, unknown>) {
  await assertWritable(me);
  const pack = editable(await ownPack(me, body.id));
  const result = await db()
    .prepare(
      'UPDATE sticker_packs SET title=?,updated=? WHERE id=? AND ownerId=? AND deletedAt=0 AND removedAt=0',
    )
    .bind(packTitle(body.title), Date.now(), pack.id, me)
    .run();
  if (!result.meta.changes) throw new ApiError(404, 'Набор не найден');
  return readPack(me, 'u:' + pack.id);
}
// Frees the files of deleted stickers at once unless something else still
// keeps them: a report, a moderator decision or another reference.
async function releaseUploads(me: string, ids: string[]) {
  if (!ids.length) return;
  const released = await db()
    .prepare(
      `UPDATE uploads SET state='deleting' WHERE id IN(SELECT value FROM json_each(?)) AND userId=? AND state='ready'
      AND NOT (${uploadReferenced('uploads.id')}) RETURNING id`,
    )
    .bind(JSON.stringify(ids), me)
    .all<{ id: string }>();
  await Promise.allSettled(
    released.results.map(async (row) => {
      await bucket().delete(row.id);
      await db()
        .prepare("DELETE FROM uploads WHERE id=? AND state='deleting'")
        .bind(row.id)
        .run();
    }),
  );
}
export async function deletePack(me: string, body: Record<string, unknown>) {
  await assertReadable(me);
  const pack = await ownPack(me, body.id);
  // A removed pack keeps its name and evidence; it only leaves the owner's list.
  if (pack.removedAt) {
    await db()
      .prepare(
        'UPDATE sticker_packs SET deletedAt=? WHERE id=? AND ownerId=? AND deletedAt=0',
      )
      .bind(Date.now(), pack.id, me)
      .run();
    return { ok: true };
  }
  const uploads = (
    await db()
      .prepare('SELECT uploadId FROM stickers WHERE packId=?')
      .bind(pack.id)
      .all<{ uploadId: string }>()
  ).results.map((row) => row.uploadId);
  const owned =
    'EXISTS(SELECT 1 FROM sticker_packs sp WHERE sp.id=? AND sp.ownerId=? AND sp.removedAt=0)';
  await db().batch([
    db()
      .prepare(
        `DELETE FROM faved_stickers WHERE stickerRef IN(SELECT 'u:'||id FROM stickers WHERE packId=?) AND ${owned}`,
      )
      .bind(pack.id, pack.id, me),
    db()
      .prepare(`DELETE FROM user_sticker_packs WHERE packRef=? AND ${owned}`)
      .bind('u:' + pack.id, pack.id, me),
    db()
      .prepare(`DELETE FROM stickers WHERE packId=? AND ${owned}`)
      .bind(pack.id, pack.id, me),
    db()
      .prepare(
        'DELETE FROM sticker_packs WHERE id=? AND ownerId=? AND removedAt=0',
      )
      .bind(pack.id, me),
  ]);
  await releaseUploads(me, uploads);
  return { ok: true };
}

function detectFormat(bytes: Uint8Array) {
  const text = (from: number, length: number) =>
    String.fromCharCode(...bytes.subarray(from, from + length));
  if (bytes.length > 8 && bytes[0] === 0x89 && text(1, 7) === 'PNG\r\n\u001a\n')
    return 'png';
  if (bytes.length > 12 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP')
    return 'webp';
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return 'tgs';
  return null;
}
// Checks a sticker file by its content, never by its name or declared type.
async function checkedStickerFile(file: File, type: PackType) {
  if (!file.size) throw new StickerFileError('Выберите файл стикера');
  const imageLimit = type === 'emoji' ? EMOJI_IMAGE_LIMIT : STICKER_IMAGE_LIMIT;
  if (file.size > Math.max(imageLimit, TGS_LIMIT))
    throw new StickerFileError(
      type === 'emoji' ? 'Эмодзи — до 128 КБ' : 'Стикер — до 512 КБ',
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = detectFormat(bytes);
  if (!format)
    throw new StickerFileError('Поддерживаются стикеры WebP, PNG и TGS');
  if (format === 'tgs') {
    const json = await inflateTgs(bytes);
    let data: { w: number; h: number };
    try {
      data = JSON.parse(json) as { w: number; h: number };
    } catch {
      throw new StickerFileError('Файл TGS повреждён');
    }
    const problem = inspectLottie(
      data,
      type === 'emoji' ? { maxSize: 512 } : { exactSize: 512 },
    );
    if (problem) throw new StickerFileError(problem);
    if (data.w !== data.h)
      throw new StickerFileError('Анимированный эмодзи должен быть квадратным');
    return { bytes, format, width: data.w, height: data.h } as const;
  }
  if (bytes.length > imageLimit)
    throw new StickerFileError(
      type === 'emoji' ? 'Эмодзи — до 128 КБ' : 'Стикер — до 512 КБ',
    );
  const size = imageSize(bytes, formats[format].type);
  if (
    !size ||
    size.width < 16 ||
    size.height < 16 ||
    size.width > 512 ||
    size.height > 512
  )
    throw new StickerFileError(
      'Размер картинки — от 16 до 512 пикселей по каждой стороне',
    );
  return { bytes, format, width: size.width, height: size.height } as const;
}
export async function addSticker(
  me: string,
  packValue: unknown,
  emojiValue: unknown,
  file: File,
) {
  await assertWritable(me);
  const pack = editable(await ownPack(me, packValue));
  const emoji = stickerEmoji(emojiValue);
  const limit = pack.type === 'emoji' ? EMOJI_PER_PACK : STICKERS_PER_PACK;
  let checked;
  try {
    checked = await checkedStickerFile(file, pack.type);
  } catch (error) {
    if (error instanceof StickerFileError)
      throw new ApiError(400, error.message);
    throw error;
  }
  const count = await db()
    .prepare(
      'SELECT COUNT(*) AS count FROM stickers WHERE packId=? AND deletedAt=0',
    )
    .bind(pack.id)
    .first<{ count: number }>();
  if ((count?.count ?? 0) >= limit)
    throw new ApiError(
      400,
      pack.type === 'emoji'
        ? `В наборе может быть до ${limit} эмодзи`
        : `В наборе может быть до ${limit} стикеров`,
    );
  const uploadId = crypto.randomUUID(),
    stickerId = crypto.randomUUID(),
    stored = formats[checked.format],
    now = Date.now();
  await reserveUpload(uploadId, me, file);
  try {
    await bucket(me).put(uploadId, checked.bytes, {
      httpMetadata: { contentType: stored.type },
    });
    const results = await db().batch([
      db()
        .prepare(
          `INSERT INTO stickers(id,packId,position,emoji,format,uploadId,width,height,created)
          SELECT ?,sp.id,COALESCE((SELECT MAX(position)+1 FROM stickers WHERE packId=sp.id),0),?,?,?,?,?,?
          FROM sticker_packs sp WHERE sp.id=? AND sp.ownerId=? AND sp.deletedAt=0 AND sp.removedAt=0
          AND (SELECT COUNT(*) FROM stickers WHERE packId=sp.id AND deletedAt=0)<?
          AND EXISTS(SELECT 1 FROM uploads up WHERE up.id=? AND up.userId=sp.ownerId AND up.state='uploading')`,
        )
        .bind(
          stickerId,
          emoji,
          checked.format,
          uploadId,
          checked.width,
          checked.height,
          now,
          pack.id,
          me,
          limit,
          uploadId,
        ),
      db()
        .prepare(
          `UPDATE uploads SET type=?,name=?,bytes=?,state='ready' WHERE id=? AND state='uploading'
          AND EXISTS(SELECT 1 FROM stickers WHERE uploadId=uploads.id)`,
        )
        .bind(stored.type, stored.name, checked.bytes.length, uploadId),
      db()
        .prepare(
          'UPDATE sticker_packs SET stickerCount=(SELECT COUNT(*) FROM stickers WHERE packId=sticker_packs.id AND deletedAt=0),updated=? WHERE id=?',
        )
        .bind(now, pack.id),
    ]);
    if (!results[1].meta.changes)
      throw new ApiError(
        409,
        'Набор изменился. Обновите его и попробуйте снова.',
      );
  } catch (error) {
    await db()
      .prepare("UPDATE uploads SET state='deleting' WHERE id=?")
      .bind(uploadId)
      .run();
    throw error;
  }
  return userInfo({
    id: stickerId,
    packId: pack.id,
    emoji,
    format: checked.format,
    uploadId,
    width: checked.width,
    height: checked.height,
    type: pack.type,
    live: 1,
  });
}
async function ownSticker(me: string, value: unknown) {
  const sticker = await db()
    .prepare(
      `SELECT st.id,st.uploadId,st.packId FROM stickers st JOIN sticker_packs sp ON sp.id=st.packId
      WHERE st.id=? AND sp.ownerId=? AND sp.deletedAt=0 AND sp.removedAt=0`,
    )
    .bind(id(value, 'Стикер не найден'), me)
    .first<{ id: string; uploadId: string; packId: string }>();
  if (!sticker) throw new ApiError(404, 'Стикер не найден');
  return sticker;
}
export async function updateSticker(me: string, body: Record<string, unknown>) {
  await assertWritable(me);
  const sticker = await ownSticker(me, body.id);
  await db()
    .prepare(
      `UPDATE stickers SET emoji=? WHERE id=? AND EXISTS(SELECT 1 FROM sticker_packs sp WHERE sp.id=stickers.packId AND sp.ownerId=? AND sp.removedAt=0)`,
    )
    .bind(stickerEmoji(body.emoji), sticker.id, me)
    .run();
  return { ok: true };
}
export async function removeSticker(me: string, body: Record<string, unknown>) {
  await assertReadable(me);
  const sticker = await ownSticker(me, body.id);
  const owned =
    'EXISTS(SELECT 1 FROM sticker_packs sp WHERE sp.id=? AND sp.ownerId=? AND sp.removedAt=0)';
  await db().batch([
    db()
      .prepare(`DELETE FROM faved_stickers WHERE stickerRef=? AND ${owned}`)
      .bind('u:' + sticker.id, sticker.packId, me),
    db()
      .prepare(`DELETE FROM stickers WHERE id=? AND packId=? AND ${owned}`)
      .bind(sticker.id, sticker.packId, sticker.packId, me),
    db()
      .prepare(
        'UPDATE sticker_packs SET stickerCount=(SELECT COUNT(*) FROM stickers WHERE packId=sticker_packs.id AND deletedAt=0),updated=? WHERE id=?',
      )
      .bind(Date.now(), sticker.packId),
  ]);
  await releaseUploads(me, [sticker.uploadId]);
  return { ok: true };
}
// New order of a pack: every sticker exactly once.
export async function reorderPack(me: string, body: Record<string, unknown>) {
  await assertWritable(me);
  const pack = editable(await ownPack(me, body.id));
  const ids = body.ids;
  if (
    !Array.isArray(ids) ||
    ids.length > EMOJI_PER_PACK ||
    ids.some((item) => typeof item !== 'string' || !UUID.test(item)) ||
    new Set(ids).size !== ids.length
  )
    throw new ApiError(400, 'Проверьте порядок стикеров');
  const current = (
    await db()
      .prepare('SELECT id FROM stickers WHERE packId=? AND deletedAt=0')
      .bind(pack.id)
      .all<{ id: string }>()
  ).results.map((row) => row.id);
  if (
    current.length !== ids.length ||
    current.some((item) => !ids.includes(item))
  )
    throw new ApiError(
      409,
      'Набор изменился. Обновите его и попробуйте снова.',
    );
  await db()
    .prepare(
      `UPDATE stickers SET position=(SELECT CAST(j.key AS INTEGER) FROM json_each(?) j WHERE j.value=stickers.id)
      WHERE packId=? AND id IN(SELECT value FROM json_each(?))
      AND EXISTS(SELECT 1 FROM sticker_packs sp WHERE sp.id=stickers.packId AND sp.ownerId=? AND sp.removedAt=0)`,
    )
    .bind(JSON.stringify(ids), pack.id, JSON.stringify(ids), me)
    .run();
  return { ok: true };
}

function packRef(value: unknown) {
  const match = typeof value === 'string' ? PACK_REF.exec(value) : null;
  if (!match) throw new ApiError(404, 'Набор не найден');
  return match[1];
}
// Personal organisation: read-only accounts may still add and remove packs.
export async function installPack(me: string, body: Record<string, unknown>) {
  await assertReadable(me);
  if (typeof body.ref === 'string' && body.ref.startsWith('b:'))
    return { ok: true };
  const packId = packRef(body.ref);
  const result = await db()
    .prepare(
      `INSERT INTO user_sticker_packs(userId,packRef,position,installedAt)
      SELECT ?,?,COALESCE((SELECT MIN(position)-1 FROM user_sticker_packs WHERE userId=?),0),?
      WHERE EXISTS(SELECT 1 FROM sticker_packs sp JOIN users o ON o.id=sp.ownerId WHERE sp.id=? AND ${livePack})
      AND (SELECT COUNT(*) FROM user_sticker_packs WHERE userId=?)<? ON CONFLICT DO NOTHING`,
    )
    .bind(me, 'u:' + packId, me, Date.now(), packId, me, STICKER_INSTALL_LIMIT)
    .run();
  if (!result.meta.changes) {
    const installed = await db()
      .prepare('SELECT 1 FROM user_sticker_packs WHERE userId=? AND packRef=?')
      .bind(me, 'u:' + packId)
      .first();
    if (installed) return { ok: true };
    const pack = await db()
      .prepare(
        `SELECT 1 FROM sticker_packs sp JOIN users o ON o.id=sp.ownerId WHERE sp.id=? AND ${livePack}`,
      )
      .bind(packId)
      .first();
    throw new ApiError(
      pack ? 400 : 404,
      pack
        ? `Можно добавить до ${STICKER_INSTALL_LIMIT} наборов. Удалите ненужные.`
        : 'Набор удалён или недоступен',
    );
  }
  return { ok: true };
}
export async function uninstallPack(me: string, body: Record<string, unknown>) {
  await assertReadable(me);
  await db()
    .prepare('DELETE FROM user_sticker_packs WHERE userId=? AND packRef=?')
    .bind(me, 'u:' + packRef(body.ref))
    .run();
  return { ok: true };
}
// Favourites keep the newest stickers, like Telegram: 5, or 10 with Premium.
export async function faveSticker(me: string, body: Record<string, unknown>) {
  await assertReadable(me);
  const ref = typeof body.ref === 'string' ? body.ref : '';
  if (typeof body.on !== 'boolean')
    throw new ApiError(400, 'Некорректный запрос');
  if (!body.on) {
    await db()
      .prepare('DELETE FROM faved_stickers WHERE userId=? AND stickerRef=?')
      .bind(me, ref.slice(0, 100))
      .run();
    return { ok: true };
  }
  const userId = USER_STICKER_REF.exec(ref)?.[1];
  if (
    !builtinSticker(ref) &&
    !(
      userId &&
      (await db()
        .prepare(
          `SELECT 1 FROM stickers st JOIN sticker_packs sp ON sp.id=st.packId JOIN users o ON o.id=sp.ownerId
          WHERE st.id=? AND st.deletedAt=0 AND sp.type='stickers' AND ${livePack}`,
        )
        .bind(userId)
        .first())
    )
  )
    throw new ApiError(404, 'Стикер удалён или недоступен');
  const limit = (await premium(me)) ? FAVE_PREMIUM_LIMIT : FAVE_LIMIT;
  await db().batch([
    db()
      // The newest favourite always sorts first, even within one millisecond.
      .prepare(
        `INSERT INTO faved_stickers(userId,stickerRef,created)
        VALUES(?,?,MAX(?,COALESCE((SELECT MAX(created)+1 FROM faved_stickers WHERE userId=?),0)))
        ON CONFLICT(userId,stickerRef) DO UPDATE SET created=excluded.created`,
      )
      .bind(me, ref, Date.now(), me),
    db()
      .prepare(
        `DELETE FROM faved_stickers WHERE userId=? AND stickerRef NOT IN(
        SELECT stickerRef FROM faved_stickers WHERE userId=? ORDER BY created DESC LIMIT ?)`,
      )
      .bind(me, me, limit),
  ]);
  return { ok: true };
}
// A report keeps the pack's files as evidence until a moderator decides.
export async function reportPack(me: string, body: Record<string, unknown>) {
  await assertReadable(me);
  const reason =
    typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (!reason) throw new ApiError(400, 'Опишите, что нарушает правила');
  const packId = id(body.id);
  const pack = await db()
    .prepare(
      `SELECT sp.id,sp.shortName,sp.title,sp.type,sp.ownerId FROM sticker_packs sp JOIN users o ON o.id=sp.ownerId WHERE sp.id=? AND ${livePack}`,
    )
    .bind(packId)
    .first<PackRow>();
  if (!pack) throw new ApiError(404, 'Набор удалён или недоступен');
  if (pack.ownerId === me) throw new ApiError(400, 'Это ваш набор');
  const stickers = await packStickers([pack.id]);
  const snapshot = {
    ...pack,
    media: stickers.map((sticker) => ({
      id: sticker.uploadId,
      format: sticker.format,
    })),
  };
  const now = Date.now();
  await db()
    .prepare(
      `INSERT OR IGNORE INTO content_reports(id,targetType,targetId,postId,userId,authorId,text,snapshot,reason,created,updated)
      SELECT ?,'sticker_pack',?,'',?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sticker_packs WHERE id=? AND removedAt=0 AND deletedAt=0)`,
    )
    .bind(
      crypto.randomUUID(),
      pack.id,
      me,
      pack.ownerId,
      pack.title,
      JSON.stringify(snapshot),
      reason,
      now,
      now,
      pack.id,
    )
    .run();
  return { ok: true };
}
export const builtinStickerPacks = () =>
  stickerCatalog.packs.map((pack) => builtinPackInfo(pack));
