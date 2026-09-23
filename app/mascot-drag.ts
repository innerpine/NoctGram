/* Slime pull toy for the Noctgram mascot: the body follows the pointer, stretches
   along the pull vector and thins across it (volume preserving), tilts in 3D, and
   on release a spring throws it back with a couple of visible wobbles.
   The idle drift is a CSS animation and would outrank an inline transform, so the
   gesture runs under a class that switches it off until the spring settles. */
import type {
  AnimationEvent as ReactAnimationEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { createVelocityTracker } from '@/lib/fluid-motion';

const FOLLOW = 0.55; // share of the pointer travel the body takes
const MAX_TRAVEL = 58; // px the body may leave its slot by, approached asymptotically
const STRETCH = 0.34;
const TILT_DEG = 14;
const STIFFNESS = 190;
const DAMPING = 13; // well under critical (2*sqrt(k)) so the return wobbles
const TICK_PULL_PX = 14; // pull step between texture ticks
const TAP_PX = 5; // travel under this is a tap, not a pull
const PULLING = 'noct-mascot--pulling';
const LANDED = 'noct-mascot--landed';
const DROP = 'noct-mascot-drop';

interface Pose {
  x: number;
  y: number;
}

/* Vibration is a nice-to-have: absent on desktop and on iOS Safari, and a no-op
   outside a user gesture. Never let it break the gesture. */
const buzz = (ms: number): void => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* Some browsers throw instead of ignoring the call. */
  }
};

/* One spring at a time. Grabbing the mascot again mid-return cancels the old run
   instead of letting two animation frames fight over the same transform. */
let spring = 0;
// Where the body is on screen right now, so a grab mid-wobble starts from there.
let live: Pose = { x: 0, y: 0 };

function paint(el: HTMLElement, { x, y }: Pose): void {
  live = { x, y };
  const dist = Math.hypot(x, y);
  const pull = Math.min(dist / MAX_TRAVEL, 1);
  const stretch = 1 + pull * STRETCH;
  const angle = dist > 0.01 ? (Math.atan2(y, x) * 180) / Math.PI : 0;
  const tiltY = (Math.max(-1, Math.min(1, x / MAX_TRAVEL)) * TILT_DEG).toFixed(2);
  const tiltX = (Math.max(-1, Math.min(1, -y / MAX_TRAVEL)) * TILT_DEG).toFixed(2);
  // The stretch is applied in the pull's own frame: rotate into it, scale, rotate
  // back. Tilt and travel wrap both.
  el.style.transform =
    `perspective(520px) translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)` +
    ` rotateY(${tiltY}deg) rotateX(${tiltX}deg)` +
    ` rotate(${angle.toFixed(2)}deg)` +
    ` scale(${stretch.toFixed(3)}, ${(1 / stretch).toFixed(3)})` +
    ` rotate(${(-angle).toFixed(2)}deg)`;
}

function rest(el: HTMLElement): void {
  live = { x: 0, y: 0 };
  el.style.transform = '';
  el.classList.remove(PULLING);
  delete el.dataset.pulling;
}

/* The entrance is a one-shot, so it has to be retired once it has played. While the
   pull runs the animation is switched off entirely, and dropping that switch would
   otherwise recreate every animation on the element — the mascot would fly back up
   and fall again after every single pull. Past the landing the element carries only
   the looping drift, which is safe to recreate. */
export function landMascot(event: ReactAnimationEvent<HTMLElement>): void {
  if (event.animationName !== DROP) return;
  event.currentTarget.classList.add(LANDED);
}

/* A tap drops the mascot in again instead of springing it back: clear the gesture,
   put the entrance back, then restart the keyframes. Setting animation to none and
   reading a layout property forces the reflow that makes the restart take effect —
   without it the browser coalesces both writes and nothing replays. */
function respawn(el: HTMLElement): void {
  spring++;
  rest(el);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.classList.remove(LANDED);
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
}

function snapBack(el: HTMLElement, from: Pose, velocity: Pose): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    rest(el);
    return;
  }
  const run = ++spring;
  let { x, y } = from;
  // The throw carries on into the return instead of stopping dead.
  let { x: vx, y: vy } = velocity;
  let last = performance.now();
  let crossed = false;
  const step = (now: number): void => {
    if (run !== spring || !el.isConnected) return;
    const dt = Math.min((now - last) / 1000, 0.032);
    last = now;
    vx += (-STIFFNESS * x - DAMPING * vx) * dt;
    vy += (-STIFFNESS * y - DAMPING * vy) * dt;
    x += vx * dt;
    y += vy * dt;
    if (!crossed && x * from.x + y * from.y < 0) {
      crossed = true;
      buzz(4);
    }
    if (Math.hypot(x, y) < 0.4 && Math.hypot(vx, vy) < 6) {
      rest(el);
      return;
    }
    paint(el, { x, y });
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function pullMascot(event: ReactPointerEvent<HTMLElement>): void {
  const el = event.currentTarget;
  if (el.dataset.pulling === 'held') return; // one pointer at a time
  const wobbling = !!el.dataset.pulling;
  spring++; // cancel a spring still running from the previous pull
  // Grabbing the mascot mid-entrance counts as landing it: from here the element
  // carries only the drift, so releasing the pull cannot replay the drop.
  el.classList.add(LANDED);
  el.dataset.pulling = 'held';
  el.classList.add(PULLING);
  el.setPointerCapture(event.pointerId);
  buzz(8);
  // Caught mid-wobble, the pull starts where the body is: unbend its offset into
  // the pointer travel that would have put it there.
  const from = wobbling ? live : { x: 0, y: 0 };
  const reach = Math.hypot(from.x, from.y);
  const unbend =
    reach > 0.01 ? (MAX_TRAVEL * Math.atanh(Math.min(reach / MAX_TRAVEL, 0.99))) / reach / FOLLOW : 0;
  const startX = event.clientX - from.x * unbend;
  const startY = event.clientY - from.y * unbend;
  let pose: Pose = from;
  let ticks = 0;
  const velocity = createVelocityTracker();
  velocity.add(pose.x, pose.y);
  const move = (moved: PointerEvent): void => {
    // Rubber band: the travel follows the pointer, then bends into MAX_TRAVEL and
    // never passes it, however far the pointer goes — the body stays inside its
    // container instead of flying across the screen.
    const dx = (moved.clientX - startX) * FOLLOW;
    const dy = (moved.clientY - startY) * FOLLOW;
    const raw = Math.hypot(dx, dy);
    const bend = raw > 0.01 ? (MAX_TRAVEL * Math.tanh(raw / MAX_TRAVEL)) / raw : 0;
    pose = { x: dx * bend, y: dy * bend };
    velocity.add(pose.x, pose.y);
    const step = Math.floor(Math.hypot(pose.x, pose.y) / TICK_PULL_PX);
    if (step !== ticks) {
      ticks = step;
      buzz(2);
    }
    paint(el, pose);
  };
  const end = (): void => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', end);
    el.removeEventListener('pointercancel', end);
    buzz(6);
    if (!wobbling && Math.hypot(pose.x, pose.y) < TAP_PX) {
      respawn(el);
      return;
    }
    el.dataset.pulling = '1';
    velocity.add(pose.x, pose.y); // a pause before letting go leaves no throw
    snapBack(el, pose, velocity.velocity());
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
