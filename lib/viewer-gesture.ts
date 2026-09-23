// Drag-to-dismiss, pinch/double-tap zoom and tap/hold for full-screen viewers.
// The sheet exposes --drag-y and --drag-progress; CSS decides how it moves.
import {
  animateSpring,
  createVelocityTracker,
  project,
  rubberband,
} from './fluid-motion';

type Point = { x: number; y: number };
export type DismissRule = { share: number; speed: number; momentum?: boolean };
export type ViewerGestureOptions = {
  /** Whether a drag may start on this target. */
  accepts: (target: Element, pointerType: string) => boolean;
  dismiss: DismissRule;
  onDismiss: () => void;
  backdrop?: () => HTMLElement | null;
  /** Pinch and double-tap target; zoomed content pans instead of dismissing. */
  zoom?: () => HTMLElement | null;
  /** A tap under 10 px, with x measured from the sheet's left edge. */
  onTap?: (x: number, width: number) => void;
  /** Pressed still for 200 ms, then released. */
  onHold?: (held: boolean) => void;
  reduced?: () => boolean;
};

const SLOP = 10;
const MAX_ZOOM = 4;

/** A fast flick decides by direction; otherwise the (projected) drag must pass a share of the height. */
export function shouldDismiss(
  offset: number,
  velocity: number,
  height: number,
  rule: DismissRule,
) {
  if (Math.abs(velocity) > rule.speed) return velocity > 0;
  return offset + (rule.momentum ? project(velocity) : 0) > height * rule.share;
}

/** Pan that keeps the content under `point` (from the element centre) in place across a scale change. */
export function zoomAbout(
  pan: Point,
  scale: number,
  next: number,
  point: Point,
): Point {
  const k = next / scale;
  return {
    x: point.x - (point.x - pan.x) * k,
    y: point.y - (point.y - pan.y) * k,
  };
}

/** How far a picture `content` px wide, shown at `scale` in a `box` px frame, may pan from centre. */
export const panLimit = (content: number, box: number, scale: number) =>
  Math.max(0, (content * scale - box) / 2);

/** 1:1 inside [min, max], rubber-banded past either end. */
export const bandInto = (
  value: number,
  min: number,
  max: number,
  dimension: number,
) =>
  value < min
    ? min + rubberband(value - min, dimension)
    : value > max
      ? max + rubberband(value - max, dimension)
      : value;

/** Transform that lays a box (untransformed centre and width) over a thumbnail. */
export function originTransform(
  box: { x: number; y: number; width: number },
  thumb: { left: number; top: number; width: number; height: number },
) {
  if (!box.width || !thumb.width || !thumb.height) return '';
  const x = thumb.left + thumb.width / 2 - box.x,
    y = thumb.top + thumb.height / 2 - box.y;
  return `translate(${x}px, ${y}px) scale(${thumb.width / box.width})`;
}

/** Mini-player sheet: 0 is open, `travel` collapsed; past either end it rubber-bands. */
export function sheetPosition(offset: number, travel: number) {
  const inside = Math.max(0, Math.min(travel, offset));
  return {
    progress: inside / travel,
    overshoot: rubberband(offset - inside, 120),
  };
}

/** A flick picks its direction; a slow release settles where momentum would stop. */
export function sheetTarget(offset: number, velocity: number, travel: number) {
  if (Math.abs(velocity) > 200) return { collapsed: velocity > 0, flick: true };
  return {
    collapsed: offset + project(velocity, 0.99) > travel / 2,
    flick: false,
  };
}

function scroller(target: Element, root: Element) {
  const view = root.ownerDocument.defaultView!;
  for (
    let node: Element | null = target;
    node && node !== root;
    node = node.parentElement
  )
    if (
      node.scrollHeight > node.clientHeight + 1 &&
      /auto|scroll/.test(view.getComputedStyle(node).overflowY)
    )
      return node;
  return null;
}

export function attachViewerGesture(
  sheet: HTMLElement,
  options: ViewerGestureOptions,
) {
  const host = sheet.ownerDocument.defaultView!;
  const pointers = new Map<number, Point>();
  const tracker = createVelocityTracker();
  let mode: 'idle' | 'pending' | 'dismiss' | 'pan' | 'pinch' | 'ignore' =
    'idle';
  // `down`: started in a scroll area at its top, so only a downward drag is ours.
  let start = { id: -1, x: 0, y: 0, offset: 0, pan: { x: 0, y: 0 } };
  let down = false,
    blocked = false,
    moved = false;
  let offset = 0,
    height = 1,
    scale = 1,
    pan = { x: 0, y: 0 };
  let pinch = { distance: 1, scale: 1, pan, mid: pan, centre: pan };
  let settle: ReturnType<typeof animateSpring> | null = null,
    zoomSettle: ReturnType<typeof animateSpring> | null = null;
  let frame = 0,
    holdTimer = 0,
    held = false,
    closing = false,
    suppressUntil = 0,
    lastTap = { time: -Infinity, x: 0, y: 0 };
  const reduced = () =>
    options.reduced?.() ??
    host.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const paintOffset = () => {
    const progress = Math.min(1, Math.max(0, offset / height));
    sheet.style.setProperty('--drag-y', `${offset}px`);
    sheet.style.setProperty('--drag-progress', String(progress));
    const shade = options.backdrop?.();
    if (shade) shade.style.opacity = String(1 - progress);
  };
  const schedule = () => {
    if (!frame)
      frame = host.requestAnimationFrame(() => {
        frame = 0;
        paintOffset();
      });
  };
  const clearOffset = () => {
    offset = 0;
    sheet.style.removeProperty('--drag-y');
    sheet.style.removeProperty('--drag-progress');
    sheet.removeAttribute('data-dragging');
    const shade = options.backdrop?.();
    if (shade) shade.style.opacity = '';
  };
  const springBack = (velocity: number) => {
    if (reduced() || !offset) {
      clearOffset();
      return;
    }
    settle = animateSpring(offset, 0, {
      damping: 1,
      response: 0.3,
      velocity,
      host,
      onUpdate: (value) => {
        offset = value;
        paintOffset();
      },
      onComplete: () => {
        settle = null;
        clearOffset();
      },
    });
  };

  const zoomTarget = () => options.zoom?.() ?? null;
  const box = (element: HTMLElement) => {
    const width = element.offsetWidth || 1,
      tall = element.offsetHeight || 1;
    const image = element as HTMLImageElement;
    const ratio =
      image.naturalWidth && image.naturalHeight
        ? image.naturalWidth / image.naturalHeight
        : width / tall;
    const content = Math.min(width, tall * ratio);
    return { width, height: tall, cw: content, ch: content / ratio };
  };
  const centre = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 - pan.x,
      y: rect.top + rect.height / 2 - pan.y,
    };
  };
  const outOfBounds = () => {
    const element = zoomTarget();
    if (!element) return false;
    const size = box(element);
    return (
      scale < 1 ||
      scale > MAX_ZOOM ||
      Math.abs(pan.x) > panLimit(size.cw, size.width, scale) + 0.5 ||
      Math.abs(pan.y) > panLimit(size.ch, size.height, scale) + 0.5
    );
  };
  const paintZoom = () => {
    const element = zoomTarget();
    if (!element) return;
    element.style.transform =
      scale === 1 && !pan.x && !pan.y
        ? ''
        : `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`;
    sheet.toggleAttribute('data-zoomed', scale > 1.01);
  };
  const settleZoom = (
    next: number,
    point: Point,
    velocity = { x: 0, y: 0 },
  ) => {
    const element = zoomTarget();
    if (!element) return;
    zoomSettle?.stop();
    const size = box(element),
      from = scale,
      origin = pan;
    const free = zoomAbout(origin, from, next, point);
    const lx = panLimit(size.cw, size.width, next),
      ly = panLimit(size.ch, size.height, next);
    const end = {
      x: Math.max(-lx, Math.min(lx, free.x + project(velocity.x))),
      y: Math.max(-ly, Math.min(ly, free.y + project(velocity.y))),
    };
    const apply = (t: number) => {
      scale = from + (next - from) * t;
      const base = zoomAbout(origin, from, scale, point);
      pan = {
        x: base.x + (end.x - free.x) * t,
        y: base.y + (end.y - free.y) * t,
      };
      paintZoom();
    };
    if (reduced()) {
      apply(1);
      return;
    }
    // Carry the release velocity along the path, in progress per second.
    const dx = end.x - origin.x,
      dy = end.y - origin.y,
      travel = dx * dx + dy * dy;
    zoomSettle = animateSpring(0, 1, {
      damping: 1,
      response: 0.3,
      velocity: travel ? (velocity.x * dx + velocity.y * dy) / travel : 0,
      host,
      onUpdate: apply,
      onComplete: () => (zoomSettle = null),
    });
  };

  const stopHold = () => {
    host.clearTimeout(holdTimer);
    holdTimer = 0;
  };
  const endHold = () => {
    stopHold();
    if (held) {
      held = false;
      options.onHold?.(false);
    }
  };
  const capture = (id: number) => {
    try {
      sheet.setPointerCapture(id);
    } catch {
      /* The pointer may already be gone. */
    }
  };
  const pair = () => {
    const [a, b] = [...pointers.values()];
    return {
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    };
  };

  const onDown = (event: PointerEvent) => {
    if (closing || (event.pointerType === 'mouse' && event.button !== 0))
      return;
    const at = { x: event.clientX, y: event.clientY };
    const zoom = zoomTarget();
    if (pointers.size) {
      // A second finger turns the gesture into a pinch.
      if (!zoom || pointers.size > 1 || mode === 'ignore') return;
      pointers.set(event.pointerId, at);
      endHold();
      if (offset) springBack(0);
      zoomSettle?.stop();
      const { mid, distance } = pair();
      pinch = { distance, scale, pan, mid, centre: centre(zoom) };
      mode = 'pinch';
      suppressUntil = Infinity;
      pointers.forEach((_, id) => capture(id));
      return;
    }
    if (
      !(event.target instanceof Element) ||
      !options.accepts(event.target, event.pointerType)
    )
      return;
    pointers.set(event.pointerId, at);
    settle?.stop();
    settle = null;
    // Nearly home counts as home, so a quick tap after a drag stays a tap.
    if (Math.abs(offset) < 1) clearOffset();
    zoomSettle?.stop();
    zoomSettle = null;
    const area = scroller(event.target, sheet);
    down = !!area;
    blocked = !!area && area.scrollTop > 0;
    moved = false;
    height = sheet.offsetHeight || 1;
    start = { id: event.pointerId, ...at, offset, pan };
    tracker.reset();
    tracker.add(at.x, at.y);
    if (offset) {
      // Caught while springing back: keep following from where it is.
      mode = 'dismiss';
      moved = true;
      sheet.setAttribute('data-dragging', '');
      capture(event.pointerId);
    } else mode = zoom && scale > 1.01 ? 'pan' : 'pending';
    if (mode === 'pending' && options.onHold)
      holdTimer = host.setTimeout(() => {
        holdTimer = 0;
        held = true;
        options.onHold?.(true);
      }, 200);
  };

  const onMove = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    const at = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, at);
    if (mode === 'pinch' && pointers.size === 2) {
      const { mid, distance } = pair();
      scale = bandInto(
        (pinch.scale * distance) / pinch.distance,
        1,
        MAX_ZOOM,
        MAX_ZOOM,
      );
      const base = zoomAbout(pinch.pan, pinch.scale, scale, {
        x: pinch.mid.x - pinch.centre.x,
        y: pinch.mid.y - pinch.centre.y,
      });
      pan = {
        x: base.x + mid.x - pinch.mid.x,
        y: base.y + mid.y - pinch.mid.y,
      };
      paintZoom();
      return;
    }
    if (event.pointerId !== start.id) return;
    tracker.add(at.x, at.y);
    const dx = at.x - start.x,
      dy = at.y - start.y;
    if (!moved && Math.max(Math.abs(dx), Math.abs(dy)) >= SLOP) {
      moved = true;
      stopHold();
      suppressUntil = Infinity;
      if (mode === 'pan') capture(event.pointerId);
      else if (mode === 'pending') {
        if (blocked || Math.abs(dy) <= Math.abs(dx) || (down && dy < 0)) {
          mode = 'ignore';
          suppressUntil = 0;
          return;
        }
        mode = 'dismiss';
        start.y = at.y;
        sheet.setAttribute('data-dragging', '');
        capture(event.pointerId);
      }
    }
    if (mode === 'dismiss') {
      const raw = start.offset + at.y - start.y;
      offset = raw < 0 ? rubberband(raw, height) : raw;
      schedule();
    } else if (mode === 'pan') {
      const element = zoomTarget();
      if (!element) return;
      const size = box(element);
      const lx = panLimit(size.cw, size.width, scale),
        ly = panLimit(size.ch, size.height, scale);
      pan = {
        x: bandInto(start.pan.x + dx, -lx, lx, size.width),
        y: bandInto(start.pan.y + dy, -ly, ly, size.height),
      };
      paintZoom();
    }
  };

  const tap = (event: PointerEvent) => {
    const zoom = zoomTarget();
    if (zoom) {
      const near =
        event.timeStamp - lastTap.time < 300 &&
        Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 30;
      lastTap = near
        ? { time: -Infinity, x: 0, y: 0 }
        : { time: event.timeStamp, x: event.clientX, y: event.clientY };
      if (near) {
        const c = centre(zoom);
        settleZoom(scale > 1.01 ? 1 : 2.5, {
          x: event.clientX - c.x,
          y: event.clientY - c.y,
        });
        return;
      }
    }
    if (options.onTap) {
      const rect = sheet.getBoundingClientRect();
      options.onTap(event.clientX - rect.left, rect.width);
    }
  };

  const finish = (event: PointerEvent, cancelled: boolean) => {
    if (!pointers.has(event.pointerId)) return;
    const mid = mode === 'pinch' ? pair().mid : null;
    pointers.delete(event.pointerId);
    if (!pointers.size && suppressUntil === Infinity)
      suppressUntil = performance.now() + 400;
    if (mid) {
      settleZoom(Math.max(1, Math.min(MAX_ZOOM, scale)), {
        x: mid.x - pinch.centre.x,
        y: mid.y - pinch.centre.y,
      });
      mode = pointers.size ? 'ignore' : 'idle';
      return;
    }
    if (event.pointerId !== start.id) {
      if (!pointers.size) mode = 'idle';
      return;
    }
    const wasHeld = held;
    endHold();
    host.cancelAnimationFrame(frame);
    frame = 0;
    // A pause before letting go must not replay the earlier speed.
    tracker.add(event.clientX, event.clientY);
    const velocity = tracker.velocity();
    if (mode === 'dismiss') {
      if (
        !cancelled &&
        offset > 0 &&
        shouldDismiss(offset, velocity.y, height, options.dismiss)
      ) {
        // Leave the offset in place: the closing transition starts from it.
        paintOffset();
        closing = true;
        sheet.removeAttribute('data-dragging');
        const shade = options.backdrop?.();
        if (shade) shade.style.opacity = '0';
        options.onDismiss();
      } else springBack(cancelled ? 0 : velocity.y);
    } else if (mode === 'pan' && moved)
      settleZoom(scale, { x: 0, y: 0 }, cancelled ? undefined : velocity);
    else if (!cancelled && !moved && !wasHeld && mode !== 'ignore') tap(event);
    // A zoom caught mid-flight stays where it was caught, unless out of bounds.
    if (!zoomSettle && outOfBounds())
      settleZoom(Math.max(1, Math.min(MAX_ZOOM, scale)), { x: 0, y: 0 });
    mode = pointers.size ? 'ignore' : 'idle';
  };
  const onUp = (event: PointerEvent) => finish(event, false);
  const onCancel = (event: PointerEvent) => finish(event, true);
  const onLost = (event: PointerEvent) => {
    // Touch starts captured by the pressed child; only our own loss matters.
    if (event.target === sheet) finish(event, true);
  };
  // Hold the browser back while the touch may still become ours; iOS would
  // otherwise scroll or bounce and cancel the pointer.
  const onTouchMove = (event: TouchEvent) => {
    if (!event.cancelable || mode === 'idle' || mode === 'ignore') return;
    if (mode === 'pending') {
      const at = pointers.get(start.id);
      if (!at) return;
      const dx = at.x - start.x,
        dy = at.y - start.y;
      if (blocked || (down && (dy < 0 || Math.abs(dx) > Math.abs(dy)))) return;
    }
    event.preventDefault();
  };
  const onClick = (event: MouseEvent) => {
    if (performance.now() < suppressUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  sheet.addEventListener('pointerdown', onDown);
  sheet.addEventListener('pointermove', onMove);
  sheet.addEventListener('pointerup', onUp);
  sheet.addEventListener('pointercancel', onCancel);
  sheet.addEventListener('lostpointercapture', onLost);
  sheet.addEventListener('touchmove', onTouchMove, { passive: false });
  sheet.addEventListener('click', onClick, true);
  const reset = () => {
    settle?.stop();
    zoomSettle?.stop();
    settle = zoomSettle = null;
    host.cancelAnimationFrame(frame);
    frame = 0;
    endHold();
    pointers.clear();
    mode = 'idle';
    closing = false;
    clearOffset();
    scale = 1;
    pan = { x: 0, y: 0 };
    paintZoom();
    sheet.removeAttribute('data-zoomed');
  };
  return {
    reset,
    dispose() {
      reset();
      sheet.removeEventListener('pointerdown', onDown);
      sheet.removeEventListener('pointermove', onMove);
      sheet.removeEventListener('pointerup', onUp);
      sheet.removeEventListener('pointercancel', onCancel);
      sheet.removeEventListener('lostpointercapture', onLost);
      sheet.removeEventListener('touchmove', onTouchMove);
      sheet.removeEventListener('click', onClick, true);
    },
  };
}
