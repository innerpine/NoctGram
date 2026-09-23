// Fluid-interface helpers after Apple's "Designing Fluid Interfaces" (WWDC 2018):
// momentum projection, rubber-banding, release velocity and an interruptible
// spring described by damping ratio and response instead of mass/stiffness.

/** Distance a flick travels before it stops, like scroll deceleration. */
export const project = (velocity: number, decelerationRate = 0.998) =>
  ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);

/** Past a bound, follow less the further the finger goes. */
export const rubberband = (
  overshoot: number,
  dimension: number,
  constant = 0.55,
) =>
  (overshoot * dimension * constant) /
  (dimension + constant * Math.abs(overshoot));

/** Release velocity in px/s from the last ~100 ms of pointer samples. */
export function createVelocityTracker(span = 100) {
  let samples: { t: number; x: number; y: number }[] = [];
  return {
    add(x: number, y: number, t = performance.now()) {
      samples.push({ t, x, y });
      while (samples.length > 2 && t - samples[0].t > span) samples.shift();
    },
    velocity() {
      const a = samples[0],
        b = samples.at(-1);
      const dt = a && b ? (b.t - a.t) / 1000 : 0;
      return dt > 0
        ? { x: (b!.x - a.x) / dt, y: (b!.y - a.y) / dt }
        : { x: 0, y: 0 };
    },
    reset() {
      samples = [];
    },
  };
}

type Host = Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'>;
export type SpringOptions = {
  /** 1 settles without overshoot; ~0.8 only after a flick carried momentum. */
  damping?: number;
  /** Seconds to reach the target; not a fixed duration. */
  response?: number;
  velocity?: number;
  onUpdate: (value: number) => void;
  onComplete?: () => void;
  host?: Host;
};

/**
 * Animates from the current value and velocity, so it can be retargeted or
 * grabbed mid-flight without a jump. stop() returns the live value and
 * velocity for the gesture that interrupts it.
 */
export function animateSpring(
  from: number,
  to: number,
  {
    damping = 1,
    response = 0.35,
    velocity = 0,
    onUpdate,
    onComplete,
    host = window,
  }: SpringOptions,
) {
  const stiffness = (2 * Math.PI) / response,
    k = stiffness * stiffness,
    c = (4 * Math.PI * damping) / response;
  let value = from,
    v = velocity,
    target = to,
    frame = 0,
    previous = 0;
  const tick = (time: number) => {
    let dt = previous ? Math.min((time - previous) / 1000, 0.04) : 1 / 120;
    previous = time;
    while (dt > 0) {
      const h = Math.min(dt, 1 / 240);
      v += (k * (target - value) - c * v) * h;
      value += v * h;
      dt -= h;
    }
    if (Math.abs(target - value) < 0.05 && Math.abs(v) < 1) {
      frame = 0;
      value = target;
      v = 0;
      onUpdate(value);
      onComplete?.();
      return;
    }
    onUpdate(value);
    frame = host.requestAnimationFrame(tick);
  };
  frame = host.requestAnimationFrame(tick);
  return {
    retarget(next: number) {
      target = next;
      if (!frame) {
        previous = 0;
        frame = host.requestAnimationFrame(tick);
      }
    },
    stop() {
      host.cancelAnimationFrame(frame);
      frame = 0;
      return { value, velocity: v };
    },
  };
}
