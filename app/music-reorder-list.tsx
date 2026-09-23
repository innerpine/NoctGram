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
import { animateSpring } from '@/lib/fluid-motion';
import { chatDragSpeed } from '@/lib/chat-drag-selection';
import { moveMusicItem, nextMusicMove } from '@/lib/music-queue';

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
  const [saving, setSaving] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const cancel = useRef<(() => void) | null>(null);
  const latest = useRef({ rows, onMove });
  latest.current = { rows, onMove };
  const positions = useRef(new Map<string, number>());
  const springs = useRef(new Map<string, ReturnType<typeof animateSpring>>());
  // The dragged row repaints itself whenever its slot moves.
  const follow = useRef<{ id: string; paint: () => void } | null>(null);
  // Shown optimistically while saves run one by one; the newest drop wins.
  const wanted = useRef<string[] | null>(null),
    flushing = useRef(false),
    lastMoved = useRef('');
  const ids = rows.map((r) => r.id);
  const signature = ids.join('|');
  const members = [...ids].sort().join('|');
  const shown = preview
    ? preview
        .map((id) => rows.find((r) => r.id === id))
        .filter((r): r is Row => !!r)
    : rows;
  useEffect(() => {
    // Our own saves change the rows too; only an outside change resets.
    if (!flushing.current && !cancel.current) setPreview(null);
  }, [signature]);
  useEffect(() => () => cancel.current?.(), [members]);
  useEffect(() => {
    if (disabled) cancel.current?.();
  }, [disabled]);
  useEffect(() => {
    const running = springs.current;
    return () => running.forEach((spring) => spring.stop());
  }, []);
  const reduced = () =>
    !!root.current?.closest('[data-motion="off"]') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function slide(node: HTMLElement, id: string, from: number, velocity = 0) {
    springs.current.get(id)?.stop();
    springs.current.delete(id);
    const done = () => {
      springs.current.delete(id);
      node.style.transform = node.style.zIndex = '';
    };
    if (!from || reduced()) {
      done();
      return;
    }
    node.style.transform = `translateY(${from}px)`;
    springs.current.set(
      id,
      animateSpring(from, 0, {
        damping: 1,
        response: 0.25,
        velocity,
        onUpdate: (y) => {
          node.style.transform = `translateY(${y}px)`;
        },
        onComplete: done,
      }),
    );
  }
  useLayoutEffect(() => {
    const list = root.current;
    if (!list) return;
    const next = new Map<string, number>();
    for (const node of list.querySelectorAll<HTMLElement>('[data-music-row]')) {
      const id = node.dataset.musicRow!,
        top = node.offsetTop;
      const before = positions.current.get(id);
      next.set(id, top);
      if (before === undefined || before === top || id === follow.current?.id)
        continue;
      // Start from where the row is on screen now, even halfway through a slide.
      const live = springs.current.get(id)?.stop();
      slide(node, id, (live?.value ?? 0) + before - top, live?.velocity);
    }
    positions.current = next;
    follow.current?.paint();
  }, [preview, signature]);
  async function flush() {
    if (flushing.current) return;
    flushing.current = true;
    setSaving(true);
    let saved = latest.current.rows.map((r) => r.id),
      failed = false,
      step: ReturnType<typeof nextMusicMove>;
    try {
      // Re-read the wanted order before every request: the latest drop wins.
      while (
        wanted.current &&
        (step = nextMusicMove(saved, wanted.current, lastMoved.current))
      ) {
        await latest.current.onMove?.(saved[step.from], saved[step.to]);
        saved = moveMusicItem(saved, step.from, step.to);
      }
    } catch {
      failed = true;
    }
    const done = !failed && wanted.current?.join('|') === saved.join('|');
    setAnnouncement(
      done
        ? `Песня перемещена на ${saved.indexOf(lastMoved.current) + 1} место`
        : 'Не удалось сохранить порядок',
    );
    wanted.current = null;
    flushing.current = false;
    setSaving(false);
    if (!cancel.current) setPreview(null);
  }
  function save(order: string[], id: string) {
    wanted.current = order;
    lastMoved.current = id;
    setPreview(order);
    void flush();
  }
  function start(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (
      event.button !== 0 ||
      disabled ||
      cancel.current ||
      !onMove ||
      !root.current
    )
      return;
    const list = root.current;
    const row = [
      ...list.querySelectorAll<HTMLElement>('[data-music-row]'),
    ].find((node) => node.dataset.musicRow === id);
    if (!row) return;
    event.preventDefault();
    const original = shown.map((r) => r.id);
    let ordered = original,
      y = event.clientY,
      frame = 0,
      carry = 0,
      moved = false,
      time = performance.now();
    const startY = y,
      startScroll = list.scrollTop,
      startTop = row.offsetTop,
      pointerId = event.pointerId;
    // Caught while settling: keep its on-screen offset.
    const grab = springs.current.get(id)?.stop().value ?? 0;
    springs.current.delete(id);
    // The finger's travel minus how far the row's own slot has moved.
    const offset = () =>
      grab +
      y -
      startY +
      list.scrollTop -
      startScroll -
      (row.offsetTop - startTop);
    const paint = () => {
      row.style.transform = `translateY(${offset()}px)`;
    };
    follow.current = { id, paint };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (!moved) return;
      const box = list.getBoundingClientRect();
      // Scroll by elapsed time so 120 Hz screens are no faster.
      carry +=
        (chatDragSpeed(y, box.top, box.bottom) *
          Math.min(32, Math.max(0, now - time))) /
        1000;
      time = now;
      const whole = Math.trunc(carry);
      if (whole) {
        list.scrollTop += whole;
        carry -= whole;
      }
      const nodes = [...list.querySelectorAll<HTMLElement>('[data-music-row]')];
      const from = ordered.indexOf(id);
      // Layout positions, unaffected by the rows' slide transforms.
      let to = nodes.findIndex(
        (node) =>
          y < box.top + node.offsetTop - list.scrollTop + node.offsetHeight / 2,
      );
      if (to < 0) to = nodes.length;
      if (to > from) to--;
      if (to !== from && to >= 0) {
        ordered = moveMusicItem(ordered, from, to);
        setPreview(ordered);
      }
      paint();
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
    const finish = (commit: boolean) => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', abort);
      window.removeEventListener('blur', abort);
      window.removeEventListener('keydown', key, true);
      cancel.current = null;
      follow.current = null;
      setDragging('');
      // Settle into the slot from wherever the finger left the row.
      row.style.zIndex = '1';
      slide(row, id, offset());
      if (commit && ordered.join('|') !== original.join('|')) save(ordered, id);
      else setPreview(wanted.current);
    };
    const up = (e: globalThis.PointerEvent) => {
      if (e.pointerId === pointerId) finish(moved);
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
      aria-busy={saving}
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
              disabled={disabled || rows.length < 2}
              aria-label={'Переместить ' + row.label}
              title="Перетащить · ↑/↓ на клавиатуре"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => start(e, row.id)}
              onKeyDown={(e) => {
                if (
                  !['ArrowUp', 'ArrowDown'].includes(e.key) ||
                  disabled ||
                  cancel.current
                )
                  return;
                e.preventDefault();
                e.stopPropagation();
                const order = shown.map((r) => r.id),
                  from = order.indexOf(row.id);
                const next = moveMusicItem(
                  order,
                  from,
                  from + (e.key === 'ArrowUp' ? -1 : 1),
                );
                if (next !== order) save(next, row.id);
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
