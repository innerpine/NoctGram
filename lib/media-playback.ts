// One audible chat media element per document: starting a voice message,
// a round video or a video pauses whatever else was playing.
const active = new WeakMap<Document, HTMLMediaElement>();
export function claimMediaPlayback(media: HTMLMediaElement) {
  const previous = active.get(media.ownerDocument);
  if (previous && previous !== media && !previous.paused) previous.pause();
  active.set(media.ownerDocument, media);
}

export const VOICE_RATES = [1, 1.5, 2] as const;
const RATE_KEY = 'noctgram:voice-rate';
export function voiceRate(): number {
  try {
    const value = Number(localStorage.getItem(RATE_KEY));
    return (VOICE_RATES as readonly number[]).includes(value) ? value : 1;
  } catch {
    return 1;
  }
}
export function nextVoiceRate(rate: number) {
  const index = (VOICE_RATES as readonly number[]).indexOf(rate);
  const next = VOICE_RATES[(index + 1) % VOICE_RATES.length];
  try {
    localStorage.setItem(RATE_KEY, String(next));
  } catch {
    /* The choice still applies for this page. */
  }
  return next;
}

// Groups have no server-side "listened" state; this device remembers which
// recordings the viewer has already played.
const LISTENED_KEY = 'noctgram:listened';
const LISTENED_LIMIT = 500;
function listenedIds(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(LISTENED_KEY) || '[]');
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
export function locallyListened(id: string) {
  return listenedIds().includes(id);
}
export function markLocallyListened(id: string) {
  const ids = listenedIds().filter((item) => item !== id);
  ids.push(id);
  try {
    localStorage.setItem(
      LISTENED_KEY,
      JSON.stringify(ids.slice(-LISTENED_LIMIT)),
    );
  } catch {
    /* Private browsing: the dot returns after a reload. */
  }
}

const RECORD_MODE_KEY = 'noctgram:record-mode';
export function preferredRecordMode(): 'voice' | 'round' {
  try {
    return localStorage.getItem(RECORD_MODE_KEY) === 'round' ? 'round' : 'voice';
  } catch {
    return 'voice';
  }
}
export function rememberRecordMode(mode: 'voice' | 'round') {
  try {
    localStorage.setItem(RECORD_MODE_KEY, mode);
  } catch {
    /* Applies until reload. */
  }
}
