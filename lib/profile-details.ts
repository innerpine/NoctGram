import { db } from './storage';
import { ApiError } from './api-error';
import { appearanceColumns } from './premium-access';
import { channelPermission, published, writableTarget } from './channel-access';
import { visibleAccount } from './account-access';
import { personalVisibility, contentPreference } from './privacy';
import type { ProfileChannelCard } from './client';

// Person profile details and personal channel cards (PROFILE_DETAILS.md).
const fields = [
  'location',
  'website',
  'instagram',
  'tiktok',
  'youtube',
  'birthday',
] as const;
export type ProfileDetailsInput = Partial<
  Record<(typeof fields)[number], string>
> & { showBirthYear?: boolean; personalChannels?: string[] };
// A bare name, @name or a profile URL on the network's own domain.
const socials = {
  instagram: [
    'instagram\\.com/',
    /^[A-Za-z0-9._]{1,30}$/,
    'Проверь имя в Instagram',
  ],
  tiktok: ['tiktok\\.com/@', /^[A-Za-z0-9._]{2,24}$/, 'Проверь имя в TikTok'],
  youtube: [
    'youtube\\.com/@',
    /^[A-Za-z0-9._-]{3,30}$/,
    'Проверь имя на YouTube',
  ],
} as const;
const siteError = 'Проверь ссылку на сайт: например, example.com',
  birthdayError = 'Проверь дату рождения',
  channelsError = 'Можно показать до трёх своих каналов';

function text(value: unknown, message: string) {
  if (typeof value !== 'string') throw new ApiError(400, message);
  return value.trim();
}
function location(value: unknown) {
  const place = text(value, 'Проверь местоположение').replace(/\s+/g, ' ');
  if (/\p{Cc}/u.test(place)) throw new ApiError(400, 'Проверь местоположение');
  if (place.length > 30)
    throw new ApiError(400, 'Местоположение — не длиннее 30 символов');
  return place;
}
function website(value: unknown) {
  const raw = text(value, siteError);
  if (!raw) return '';
  // Stored as typed, so кто.рф is not shown as punycode; browsers parse it like new URL() does.
  const typed = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw;
  let url: URL;
  try {
    url = new URL(typed);
  } catch {
    throw new ApiError(400, siteError);
  }
  if (
    /[\s\\\p{Cc}]/u.test(raw) ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !/^[^.]+(\.[^.]+)+$/.test(url.hostname) ||
    typed.length > 100
  )
    throw new ApiError(400, siteError);
  return typed;
}
function social(value: unknown, kind: keyof typeof socials) {
  const [path, pattern, message] = socials[kind],
    raw = text(value, message);
  const url = new RegExp(
    `^(?:https?://)?(?:(?:www|m)\\.)?${path}([^/?#]*)/?(?:[?#].*)?$`,
    'i',
  ).exec(raw);
  const name = url ? url[1] : raw.replace(/^@/, '');
  if (raw && !pattern.test(name)) throw new ApiError(400, message);
  return name;
}
function birthday(value: unknown) {
  const raw = text(value, birthdayError);
  if (!raw) return '';
  const date = new Date(raw + 'T00:00:00Z');
  // One day of slack: the owner's «today» may already be tomorrow in UTC.
  const latest = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
    isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== raw ||
    raw < '1900-01-01' ||
    raw > latest
  )
    throw new ApiError(400, birthdayError);
  return raw;
}
async function personalChannels(value: unknown, me: string) {
  if (
    !Array.isArray(value) ||
    value.length > 3 ||
    value.some((id) => typeof id !== 'string' || !id || id.length > 100) ||
    new Set(value).size !== value.length
  )
    throw new ApiError(400, channelsError);
  const ids = value as string[];
  if (
    ids.length &&
    (
      await db()
        .prepare(
          `SELECT COUNT(*) AS n FROM users WHERE id IN(${ids.map(() => '?').join(',')}) AND kind='channel' AND ownerId=? AND deletedAt=0`,
        )
        .bind(...ids, me)
        .first<{ n: number }>()
    )?.n !== ids.length
  )
    throw new ApiError(400, channelsError);
  return ids;
}
/** Validates only the fields the client sent: a missing field keeps the stored value. */
export async function profileDetailsInput(
  b: Record<string, unknown>,
  me: string,
) {
  const input: ProfileDetailsInput = {};
  if (b.location !== undefined) input.location = location(b.location);
  if (b.website !== undefined) input.website = website(b.website);
  for (const kind of ['instagram', 'tiktok', 'youtube'] as const)
    if (b[kind] !== undefined) input[kind] = social(b[kind], kind);
  if (b.birthday !== undefined) input.birthday = birthday(b.birthday);
  if (b.showBirthYear !== undefined) {
    if (typeof b.showBirthYear !== 'boolean')
      throw new ApiError(400, birthdayError);
    input.showBirthYear = b.showBirthYear;
  }
  if (b.personalChannels !== undefined)
    input.personalChannels = await personalChannels(b.personalChannels, me);
  return input;
}
/**
 * Writes for the actor's own profile. `eligibility` is the profile save's input
 * CTE, so these rows change only in the batch whose users UPDATE also applies.
 */
export function profileDetailsStatements(
  me: string,
  input: ProfileDetailsInput,
  eligibility: string,
  eligibilityArgs: unknown[],
) {
  const d = db(),
    now = Date.now(),
    statements: D1PreparedStatement[] = [];
  const gate = `EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.id IN(SELECT id FROM eligible) AND ${channelPermission('u', 'profile')} AND ${writableTarget('u')})`,
    gateArgs = [me, me, me, me, me];
  if (
    fields.some((f) => input[f] !== undefined) ||
    input.showBirthYear !== undefined
  )
    statements.push(
      d
        .prepare(
          `${eligibility} INSERT OR IGNORE INTO profile_details(userId,updated) SELECT ?,? WHERE ${gate}`,
        )
        .bind(...eligibilityArgs, me, now, ...gateArgs),
      // Only the fixed column names above enter SQL; NULL keeps the stored value.
      d
        .prepare(
          `${eligibility} UPDATE profile_details SET ${fields.map((f) => `${f}=COALESCE(?,${f})`).join(',')},showBirthYear=COALESCE(?,showBirthYear),updated=? WHERE userId=? AND ${gate}`,
        )
        .bind(
          ...eligibilityArgs,
          ...fields.map((f) => input[f] ?? null),
          input.showBirthYear === undefined
            ? null
            : Number(input.showBirthYear),
          now,
          me,
          ...gateArgs,
        ),
    );
  if (input.personalChannels) {
    statements.push(
      d
        .prepare(
          `${eligibility} DELETE FROM profile_channels WHERE userId=? AND ${gate}`,
        )
        .bind(...eligibilityArgs, me, ...gateArgs),
    );
    input.personalChannels.forEach((id, position) =>
      statements.push(
        d
          .prepare(
            `${eligibility} INSERT INTO profile_channels(userId,channelId,position) SELECT c.ownerId,c.id,? FROM users c WHERE c.id=? AND c.kind='channel' AND c.ownerId=? AND c.deletedAt=0 AND ${gate}`,
          )
          .bind(...eligibilityArgs, position, id, me, ...gateArgs),
      ),
    );
  }
  return statements;
}
/** `raw` is profile()'s json_object of the profile_details row (NULL without one). */
export function personDetails(raw: unknown, own: boolean) {
  const row = JSON.parse(typeof raw === 'string' ? raw : '{}');
  const showBirthYear = row.showBirthYear !== 0,
    birthday: string = row.birthday || '';
  return {
    location: row.location || '',
    website: row.website || '',
    instagram: row.instagram || '',
    tiktok: row.tiktok || '',
    youtube: row.youtube || '',
    birthday: own || showBirthYear ? birthday : birthday.slice(5),
    ...(own ? { showBirthYear } : {}),
  };
}
/** The first 200 characters, never cutting an emoji or a :noct_…: token in half. */
function preview(text: string) {
  const characters = Array.from(
    new Intl.Segmenter().segment(text),
    (s) => s.segment,
  );
  let end = characters.slice(0, 200).join('').length;
  for (const m of text.matchAll(/:noct_[a-z0-9_]+:/g))
    if (m.index < end && m.index + m[0].length > end) end = m.index;
  return text.slice(0, end);
}
/**
 * One query for all cards, with the same visibility rules as the feed. The owner
 * also sees cards of their temporarily blocked channels, so a save seeded from
 * this list keeps them.
 */
export async function profileChannels(
  id: string,
  me: string,
): Promise<ProfileChannelCard[]> {
  const own = id === me;
  const rows = await db()
    .prepare(
      `SELECT c.id,c.name,c.avatar,c.kind,c.ownerId,${appearanceColumns('c')},(SELECT handle FROM handles WHERE userId=c.id AND main=1 LIMIT 1) AS handle,(SELECT COUNT(*) FROM follows f JOIN users fu ON fu.id=f.follower WHERE f.following=c.id AND ${visibleAccount('fu')}) AS followers,(SELECT json_object('id',p.id,'text',substr(p.text,1,2000),'media',CASE WHEN json_extract(p.media,'$[0].type') LIKE 'image/%' THEN 'photo' WHEN json_extract(p.media,'$[0].type') LIKE 'video/%' THEN 'video' WHEN json_array_length(p.media)>0 THEN 'file' ELSE '' END,'poll',p.poll<>'[]','code',p.code<>'','created',p.created) FROM posts p WHERE p.userId=c.id AND ${published('p')} AND ${contentPreference('p')} ORDER BY p.created DESC,p.id DESC LIMIT 1) AS post FROM profile_channels pc JOIN users c ON c.id=pc.channelId WHERE pc.userId=? AND c.kind='channel' AND c.ownerId=pc.userId AND ${own ? 'c.deletedAt=0' : `${visibleAccount('c')} AND ${personalVisibility('c')}`} ORDER BY pc.position`,
    )
    .bind(...(own ? [me, id] : [me, id, me]))
    .all<Omit<ProfileChannelCard, 'post'> & { post: string | null }>();
  return rows.results.map((row) => {
    const post = row.post ? JSON.parse(row.post) : null;
    return {
      ...row,
      post: post && {
        ...post,
        text: preview(post.text),
        poll: !!post.poll,
        code: !!post.code,
      },
    };
  });
}
