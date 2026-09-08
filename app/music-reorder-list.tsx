'use client';
/* Pointer gestures own transient row order; the parent owns persisted order. */
/* eslint-disable react/react-compiler */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
} from 'react';
import { GripVertical } from 'lucide-react';
import { moveMusicItem } from '@/lib/music-queue';

type Row = { id: string; label: string; content: ReactNode };
export function MusicReorderList({
  rows,
  className,
  disabled = false,
  onMove,
}: {
  rows: Row[];
  className: string;
  disabled?: boolean;
  onMove?: (fromId: string, targetId: string) => Promise<void> | void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState('');
  const [pending, setPending] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const locked = useRef(false),
    cancel = useRef<(() => void) | null>(null);
  const latest = useRef({ rows, onMove });
  latest.current = { rows, onMove };
  const positions = useRef(new Map<string, number>());
  const ids = rows.map((r) => r.id);
  const signature = ids.join('|');
  const shown = preview
    ? preview
        .map((id) => rows.find((r) => r.id === id))
        .filter((r): r is Row => !!r)
    : rows;
  useEffect(() => {
    setPreview(null);
    return () => cancel.current?.();
  }, [signature]);
  useEffect(() => {
    if (disabled) cancel.current?.();
  }, [disabled]);
  useLayoutEffect(() => {
    const list = root.current;
    if (!list) return;
    const reduce =
      !!list.closest('[data-motion="off"]') ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, number>();
    for (const node of list.querySelectorAll<HTMLElement>('[data-music-row]')) {
      const id = node.dataset.musicRow!,
        top = node.offsetTop;
      const before = positions.current.get(id);
      if (!reduce && before !== undefined && before !== top) {
        node.getAnimations().forEach((animation) => animation.cancel());
        node.animate(
          [
            { transform: `translateY(${before - top}px)` },
            { transform: 'translateY(0)' },
          ],
          { duration: 180, easing: 'cubic-bezier(.2,.75,.25,1)' },
        );
      }
      next.set(id, top);
    }
    positions.current = next;
  }, [preview, signature]);
  async function commit(original: string[], ordered: string[], id: string) {
    const from = original.indexOf(id),
      to = ordered.indexOf(id);
    if (from === to || from < 0 || to < 0) {
      setPreview(null);
      return;
    }
    locked.current = true;
    setPending(true);
    try {
      await latest.current.onMove?.(id, original[to]);
      setAnnouncement(`Песня перемещена на ${to + 1} место`);
    } catch {
      setAnnouncement('Не удалось сохранить порядок');
    } finally {
      locked.current = false;
      setPending(false);
      setPreview(null);
    }
  }
  function start(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (
      event.button !== 0 ||
      disabled ||
      locked.current ||
      !onMove ||
      !root.current
    )
      return;
    event.preventDefault();
    const list = root.current,
      original = [...ids];
    let ordered = [...ids],
      y = event.clientY,
      frame = 0,
      moved = false;
    const startY = y,
      pointerId = event.pointerId;
    const tick = () => {
      if (moved) {
        const box = list.getBoundingClientRect();
        const edge = 44;
        const velocity =
          y < box.top + edge
            ? -Math.min(15, (box.top + edge - y) / 4)
            : y > box.bottom - edge
              ? Math.min(15, (y - box.bottom + edge) / 4)
              : 0;
        if (velocity) list.scrollTop += velocity;
        const nodes = [
          ...list.querySelectorAll<HTMLElement>('[data-music-row]'),
        ];
        const from = ordered.indexOf(id);
        // Use layout positions, unaffected by the siblings' entrance animation.
        let to = nodes.findIndex(
          (node) =>
            y <
            box.top + node.offsetTop - list.scrollTop + node.offsetHeight / 2,
        );
        if (to < 0) to = nodes.length;
        if (to > from) to--;
        if (to !== from && to >= 0) {
          ordered = moveMusicItem(ordered, from, to);
          setPreview(ordered);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      y = e.clientY;
      if (!moved && Math.abs(y - startY) >= 4) {
        moved = true;
        setDragging(id);
      }
      if (e.cancelable) e.preventDefault();
    };
    const finish = (save: boolean) => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', abort);
      window.removeEventListener('blur', abort);
      window.removeEventListener('keydown', key, true);
      cancel.current = null;
      setDragging('');
      if (save && moved) void commit(original, ordered, id);
      else setPreview(null);
    };
    const up = (e: globalThis.PointerEvent) => {
      if (e.pointerId === pointerId) finish(true);
    };
    const abort = () => finish(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    };
    cancel.current = abort;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', abort);
    window.addEventListener('blur', abort);
    window.addEventListener('keydown', key, true);
    frame = requestAnimationFrame(tick);
  }
  return (
    <div
      className={className + ' music-sort-list'}
      ref={root}
      aria-busy={pending}
    >
      {shown.map((row) => (
        <div
          className="music-sort-row"
          data-music-row={row.id}
          data-dragging={dragging === row.id}
          key={row.id}
        >
          {onMove && (
            <button
              type="button"
              className="music-sort-handle"
              disabled={disabled || pending || rows.length < 2}
              aria-label={'Переместить ' + row.label}
              title="Перетащить · ↑/↓ на клавиатуре"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => start(e, row.id)}
              onKeyDown={(e) => {
                if (
                  !['ArrowUp', 'ArrowDown'].includes(e.key) ||
                  disabled ||
                  locked.current
                )
                  return;
                e.preventDefault();
                e.stopPropagation();
                const from = ids.indexOf(row.id),
                  to = from + (e.key === 'ArrowUp' ? -1 : 1);
                const next = moveMusicItem(ids, from, to);
                setPreview(next);
                void commit(ids, next, row.id);
              }}
            >
              <GripVertical size={17} />
            </button>
          )}
          {row.content}
        </div>
      ))}
      <output className="sr-only">{announcement}</output>
    </div>
  );
}
