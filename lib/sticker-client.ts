import { useEffect, useState } from 'react';
import { chatRequest } from './chat-client';
import { builtinInfo, builtinItem } from './sticker-catalog';
import type {
  StickerInfo,
  StickerPackInfo,
  StickerPanel,
} from './sticker-types';

// Opens the sticker pack preview from anywhere: a sticker in a chat, a link.
export const OPEN_STICKER_PACK = 'noctgram:open-sticker-pack';
export function openStickerPack(name: string) {
  window.dispatchEvent(
    new CustomEvent(OPEN_STICKER_PACK, { detail: { name } }),
  );
}
// Opens «Мои наборы», optionally on one pack.
export const MANAGE_STICKERS = 'noctgram:manage-stickers';
export function manageStickers(packId?: string) {
  window.dispatchEvent(
    new CustomEvent(MANAGE_STICKERS, { detail: { packId } }),
  );
}
export const stickerPackLink = (shortName: string) =>
  `${window.location.origin}/?stickers=${encodeURIComponent(shortName)}`;

// The panel of the signed-in account, shared by every picker on the page.
let panel: StickerPanel | null = null,
  owner = '',
  loading: Promise<StickerPanel> | null = null;
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((listener) => listener());
export function loadStickerPanel(meId: string, force = false) {
  if (owner !== meId) {
    owner = meId;
    panel = null;
    loading = null;
  }
  if (panel && !force) return Promise.resolve(panel);
  if (loading && !force) return loading;
  const request: Promise<StickerPanel> = chatRequest<StickerPanel>(
    '/api/stickers?action=panel&actor=' + encodeURIComponent(meId),
    { cache: 'no-store' },
  )
    .then((value) => {
      if (loading === request && owner === meId) {
        panel = value;
        for (const sticker of [
          ...value.favorites,
          ...value.packs.flatMap((pack) => pack.stickers),
        ])
          remember(sticker);
        publish();
      }
      return value;
    })
    .finally(() => {
      if (loading === request) loading = null;
    });
  loading = request;
  return request;
}
export function useStickerPanel(meId: string | undefined) {
  const [value, setValue] = useState<StickerPanel | null>(
    meId && owner === meId ? panel : null,
  );
  const [error, setError] = useState('');
  useEffect(() => {
    if (!meId) return;
    let active = true;
    const update = () => {
      if (active && owner === meId) setValue(panel);
    };
    listeners.add(update);
    loadStickerPanel(meId)
      .then(update)
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
      listeners.delete(update);
    };
  }, [meId]);
  return { panel: value, error };
}

// Sticker details for messages and custom emoji, fetched in small batches.
const known = new Map<string, Promise<StickerInfo>>();
const pending = new Map<
  string,
  { resolve: (value: StickerInfo) => void; reject: (error: Error) => void }
>();
let timer: ReturnType<typeof setTimeout> | undefined;
function remember(sticker: StickerInfo) {
  known.delete(sticker.ref);
  known.set(sticker.ref, Promise.resolve(sticker));
  if (known.size > 600) known.delete(known.keys().next().value!);
}
async function flush() {
  timer = undefined;
  const batch = [...pending.entries()].slice(0, 60);
  for (const [ref] of batch) pending.delete(ref);
  if (pending.size) timer = setTimeout(() => void flush(), 0);
  try {
    const { stickers } = await chatRequest<{ stickers: StickerInfo[] }>(
      '/api/stickers?action=resolve&refs=' +
        encodeURIComponent(batch.map(([ref]) => ref).join(',')),
      { cache: 'no-store' },
    );
    for (const [ref, waiter] of batch) {
      const found = stickers.find((sticker) => sticker.ref === ref);
      if (found) waiter.resolve(found);
      else waiter.reject(new Error('Стикер недоступен'));
    }
  } catch (error) {
    for (const [ref, waiter] of batch) {
      known.delete(ref);
      waiter.reject(error instanceof Error ? error : new Error('Ошибка'));
    }
  }
}
export function resolveSticker(ref: string): Promise<StickerInfo> {
  const found = builtinItem(ref);
  if (found) return Promise.resolve(builtinInfo(found.pack, found.item));
  const cached = known.get(ref);
  if (cached) return cached;
  const promise = new Promise<StickerInfo>((resolve, reject) =>
    pending.set(ref, { resolve, reject }),
  );
  known.set(ref, promise);
  if (known.size > 600) known.delete(known.keys().next().value!);
  timer ??= setTimeout(() => void flush(), 16);
  return promise;
}
// Built-in stickers resolve at once; others after one batched request.
export function useSticker(ref: string) {
  const found = builtinItem(ref);
  const [state, setState] = useState<{
    ref: string;
    sticker: StickerInfo | null;
    failed: boolean;
  }>({ ref, sticker: null, failed: false });
  useEffect(() => {
    if (builtinItem(ref)) return;
    let active = true;
    resolveSticker(ref)
      .then((sticker) => {
        if (active) setState({ ref, sticker, failed: false });
      })
      .catch(() => {
        if (active) setState({ ref, sticker: null, failed: true });
      });
    return () => {
      active = false;
    };
  }, [ref]);
  if (found)
    return { sticker: builtinInfo(found.pack, found.item), failed: false };
  return state.ref === ref
    ? { sticker: state.sticker, failed: state.failed }
    : { sticker: null, failed: false };
}

// Recently sent stickers stay on this device, like Telegram's «Недавние».
const RECENT = 'noctgram:recent-stickers:';
export function recentStickers(meId: string): string[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(RECENT + meId) || '[]',
    );
    return Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}
export function rememberRecentSticker(meId: string, ref: string) {
  try {
    localStorage.setItem(
      RECENT + meId,
      JSON.stringify(
        [ref, ...recentStickers(meId).filter((item) => item !== ref)].slice(
          0,
          20,
        ),
      ),
    );
  } catch {
    // Storage may be unavailable; recents are only a convenience.
  }
}

export function stickerAction<T = { ok: true }>(
  meId: string,
  body: Record<string, unknown>,
) {
  return chatRequest<T>('/api/stickers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, actor: meId }),
  });
}
export async function uploadSticker(
  meId: string,
  pack: string,
  emoji: string,
  file: File,
) {
  const form = new FormData();
  form.set('file', file);
  form.set('pack', pack);
  form.set('emoji', emoji);
  form.set('actor', meId);
  return chatRequest<StickerInfo>('/api/stickers', {
    method: 'POST',
    body: form,
  });
}
export function readStickerPack(meId: string, name: string) {
  return chatRequest<StickerPackInfo>(
    '/api/stickers?action=pack&name=' +
      encodeURIComponent(name) +
      '&actor=' +
      encodeURIComponent(meId),
    { cache: 'no-store' },
  );
}
export function readMyStickerPacks(meId: string) {
  return chatRequest<{ packs: StickerPackInfo[]; limit: number }>(
    '/api/stickers?action=mine&actor=' + encodeURIComponent(meId),
    { cache: 'no-store' },
  );
}
