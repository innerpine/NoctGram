type Box = Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>;
/** `move` slides at the new size, `scale` also grows from the old size, and
 * `height` reveals an overflow-clipped element between its two heights. */
export type FlipMode = 'move' | 'scale' | 'height';

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;

/** Keyframes that play an element from its previous box into its layout box. */
export function flipFrames(
  before: Box,
  after: Box,
  mode: FlipMode,
): Keyframe[] | null {
  // Nothing was drawn before, or nothing is drawn now: no path to animate.
  if (!before.width || !before.height || !after.width || !after.height)
    return null;
  if (mode === 'height')
    return near(before.height, after.height)
      ? null
      : [
          { maxHeight: before.height + 'px' },
          { maxHeight: after.height + 'px' },
        ];
  if (mode === 'move')
    return near(before.left, after.left) && near(before.top, after.top)
      ? null
      : [
          {
            translate: `${before.left - after.left}px ${before.top - after.top}px`,
          },
          { translate: '0 0' },
        ];
  const x = before.left + before.width / 2 - (after.left + after.width / 2),
    y = before.top + before.height / 2 - (after.top + after.height / 2);
  return near(x, 0) &&
    near(y, 0) &&
    near(before.width, after.width) &&
    near(before.height, after.height)
    ? null
    : [
        {
          translate: `${x}px ${y}px`,
          scale: `${before.width / after.width} ${before.height / after.height}`,
        },
        { translate: '0 0', scale: '1 1' },
      ];
}

const running = new WeakMap<Element, Animation>();

/**
 * FLIP after a single layout change: `before` is where the element was drawn
 * (a slide still in flight included), so an interrupted slide continues from
 * there instead of jumping. Only translate/scale (or one clip height) animate.
 */
export function flip(
  element: HTMLElement,
  before: Box,
  mode: FlipMode = 'move',
  duration = 280,
) {
  running.get(element)?.cancel();
  running.delete(element);
  if (
    !element.isConnected ||
    !element.animate ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  )
    return;
  const frames = flipFrames(before, element.getBoundingClientRect(), mode);
  if (frames)
    running.set(
      element,
      element.animate(frames, {
        duration,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      }),
    );
}
