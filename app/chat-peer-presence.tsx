'use client';
import { useEffect, useState } from 'react';

const relative = new Intl.RelativeTimeFormat('ru', { numeric: 'always' });
const units = [
  [365 * 86400000, 'year', 'г.'],
  [30 * 86400000, 'month', 'мес.'],
  [86400000, 'day', 'дн.'],
  [3600000, 'hour', 'ч.'],
  [60000, 'minute', 'мин.'],
] as const;

export function ChatPeerPresence({ lastSeen }: { lastSeen?: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => {
      if (!document.hidden) setNow(Date.now());
    };
    const timer = setInterval(update, 15000);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  const known = Number.isFinite(lastSeen) && Number(lastSeen) > 0;
  const elapsed = known ? Math.max(0, now - lastSeen!) : 0;
  const online = known && elapsed < 120000;
  let full = online ? 'В сети' : 'Не в сети';
  let compact = full;
  if (known && !online) {
    const [duration, unit, short] = units.find(
      ([duration]) => elapsed >= duration,
    )!;
    const count = Math.floor(elapsed / duration);
    full = 'Был(а) в сети ' + relative.format(-count, unit);
    compact = `${count} ${short} назад`;
  }
  return (
    <small
      className="chat-peer-presence"
      data-online={online}
      title={full}
      aria-label={full}
    >
      <span className="chat-presence-full" aria-hidden="true">
        {full}
      </span>
      <span className="chat-presence-compact" aria-hidden="true">
        {compact}
      </span>
    </small>
  );
}
