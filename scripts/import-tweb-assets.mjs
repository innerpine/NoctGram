// Imports the built-in sticker packs and custom emoji from the public Lottie
// assets of Telegram Web K at a pinned revision. Files are copied byte for
// byte; no tweb code is used. Run: node scripts/import-tweb-assets.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { inspectLottie } from '../lib/tgs-validate.ts';
import {
  readCatalog,
  sha256,
  upsertPack,
  writeCatalog,
  writeSources,
} from './lib/sticker-catalog-writer.mjs';

const revision = '8125029807ad94a6c35492229113d4386c3a8f52';
const source = `https://raw.githubusercontent.com/morethanwords/tweb/${revision}/public/assets/tgs`;
const folder = new URL('../public/assets/stickers/', import.meta.url);

// [file name, slug, emoji]
const packs = [
  {
    id: 'utya',
    type: 'stickers',
    title: 'Утя',
    items: [
      ['UtyanBirthday', 'birthday', '🎂'],
      ['UtyanDisappear', 'disappear', '🙈'],
      ['UtyanDiscussion', 'discussion', '💬'],
      ['UtyanLinks', 'links', '🔗'],
      ['UtyanPasscode', 'passcode', '🔐'],
      ['UtyanRestricted', 'restricted', '🚫'],
      ['UtyanSearch', 'search', '🔍'],
      ['UtyanStories', 'stories', '📸'],
    ],
  },
  {
    id: 'monkey',
    type: 'stickers',
    title: 'Обезьянка',
    items: [
      ['TwoFactorSetupMonkeyIdle', 'idle', '🐵'],
      ['TwoFactorSetupMonkeyTracking', 'tracking', '👀'],
      ['TwoFactorSetupMonkeyClose', 'close', '🙈'],
      ['TwoFactorSetupMonkeyPeek', 'peek', '🫣'],
      ['TwoFactorSetupMonkeyCloseAndPeek', 'close_peek', '😏'],
      ['TwoFactorSetupMonkeyCloseAndPeekToIdle', 'back', '🙂'],
    ],
  },
  {
    id: 'holiday',
    type: 'stickers',
    title: 'Праздник',
    items: [
      ['Cake', 'cake', '🍰'],
      ['Congratulations', 'congratulations', '🎉'],
      ['Gift3', 'gift', '🎁'],
      ['Gift6', 'gift_bow', '🎀'],
      ['Gift12', 'gift_big', '🎊'],
      ['Diamond', 'diamond', '💎'],
      ['LoveLetter', 'love_letter', '💌'],
      ['Mailbox', 'mailbox', '📬'],
      ['jolly_roger', 'jolly_roger', '🏴‍☠️'],
      ['key', 'key', '🔑'],
      ['hand_stop', 'stop', '✋'],
      ['StatsEmoji', 'stats', '📊'],
      ['EmptyFolder', 'empty_folder', '📂'],
      ['Folders_1', 'folder', '📁'],
      ['Folders_2', 'folders', '🗂'],
      ['Folders_Shared', 'cloud', '☁️'],
      ['ChatAutomation', 'automation', '🤖'],
      ['Cubigator2', 'dino', '🦖'],
    ],
  },
  // Custom emoji: tokens are :noct_<slug>:, sharing files with the packs.
  // Slugs must not repeat the names of the older premium emoji.
  {
    id: 'tgweb',
    type: 'emoji',
    title: 'Telegram Web',
    items: [
      ['StarReaction', 'star_gold', '⭐'],
      ['StarReactionSelect', 'star_shine', '🌟'],
      ['StarReactionAppear', 'sparkles', '✨'],
      ['Diamond', 'diamond', '💎'],
      ['key', 'key', '🔑'],
      ['hand_stop', 'stop', '✋'],
      ['LoveLetter', 'letter', '💌'],
      ['Mailbox', 'mailbox', '📬'],
      ['Cake', 'cake', '🍰'],
      ['Gift3', 'gift', '🎁'],
      ['Congratulations', 'party', '🎉'],
      ['jolly_roger', 'pirate', '🏴‍☠️'],
      ['Cubigator2', 'dino', '🦖'],
      ['StatsEmoji', 'chart', '📊'],
      ['Folders_1', 'folder', '📁'],
      ['UtyanSearch', 'duck', '🐥'],
    ],
  },
];

await mkdir(new URL('tgs/', folder), { recursive: true });
const downloaded = new Map();
async function download(name) {
  if (downloaded.has(name)) return downloaded.get(name);
  const url = `${source}/${name}.json`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 1_000_000) throw new Error(`${name}: unexpectedly large`);
  const data = JSON.parse(bytes.toString('utf8'));
  // Built-in icons may run longer than the 3 seconds allowed for uploads.
  const problem = inspectLottie(data, { maxSize: 512, maxSeconds: 10 });
  if (problem) throw new Error(`${name}: ${problem}`);
  const file = { name, url, bytes, width: data.w, height: data.h };
  downloaded.set(name, file);
  await writeFile(new URL(`tgs/${name}.json`, folder), bytes);
  return file;
}
// Packs from other importers stay; the Telegram Web K packs are replaced.
const catalog = await readCatalog();
catalog.revision = revision;
for (const pack of packs) {
  const items = [];
  for (const [name, slug, emoji] of pack.items) {
    const file = await download(name);
    items.push({
      id: `${pack.id}:${slug}`,
      slug,
      emoji,
      format: 'lottie',
      path: `/assets/stickers/tgs/${name}.json`,
      w: file.width,
      h: file.height,
    });
  }
  upsertPack(catalog, {
    id: pack.id,
    type: pack.type,
    title: pack.title,
    source: 'Telegram Web K',
    items,
  });
}
await writeSources(
  [...downloaded.values()].map((file) => ({
    file: `tgs/${file.name}.json`,
    url: file.url,
    sha256: sha256(file.bytes),
    bytes: file.bytes.length,
  })),
  {
    header: {
      source: 'https://github.com/morethanwords/tweb',
      revision,
      license:
        'Files from the public/assets/tgs folder of the Telegram Web K repository (GPL-3.0). The artwork belongs to Telegram. Only these animation files are copied; no tweb code is used.',
    },
    drop: (row) => row.file.startsWith('tgs/'),
  },
);
await writeCatalog(catalog);
console.log(
  `Imported ${downloaded.size} files into ${packs.length} packs (${revision}).`,
);
