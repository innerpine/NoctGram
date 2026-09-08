/** Motion belongs to this message list; it must never scroll the page or player. */
export function createChatNavigator(
  list: HTMLElement,
  onInterrupt?: () => void,
) {
  let frame = 0;
  let arrival: HTMLElement | null = null;
  let pulse: Animation | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const reduced = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clearArrival = () => {
    if (pulse) {
      pulse.onfinish = null;
      pulse.cancel();
      pulse = null;
    }
    clearTimeout(timer);
    arrival?.removeAttribute('data-chat-arrival');
    arrival = null;
  };
  const cancel = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    clearArrival();
  };
  const emphasize = (target: HTMLElement) => {
    if (!list.contains(target) || disposed) return;
    // Gifts have a wide event wrapper; illuminate the rounded card itself.
    const surface =
      target.querySelector<HTMLElement>('.chat-gift-card') || target;
    const style = getComputedStyle(surface);
    const baseShadow = style.boxShadow || 'none';
    arrival = surface;
    surface.setAttribute('data-chat-arrival', '');
    if (reduced() || !surface.animate) {
      timer = setTimeout(clearArrival, 1300);
      return;
    }
    const accent = style.getPropertyValue('--chat-accent').trim() || '#cbbadb';
    const glow = `${baseShadow === 'none' ? '' : baseShadow + ','} 0 0 0 1px color-mix(in srgb, ${accent} 35%, transparent), 0 0 28px color-mix(in srgb, ${accent} 28%, transparent), inset 0 0 0 100vmax color-mix(in srgb, ${accent} 12%, transparent)`;
    pulse = surface.animate(
      [
        { boxShadow: baseShadow, offset: 0 },
        { boxShadow: glow, offset: 0.15 },
        { boxShadow: glow, offset: 0.55 },
        { boxShadow: baseShadow, offset: 1 },
      ],
      { duration: 1300, easing: 'ease-in-out' },
    );
    pulse.onfinish = clearArrival;
  };
  const move = (
    destination: number | (() => number),
    smooth: boolean,
    arrived?: () => void,
  ) => {
    cancel();
    if (disposed) return;
    const from = list.scrollTop;
    const endpoint = () =>
      Math.max(
        0,
        Math.min(
          typeof destination === 'function' ? destination() : destination,
          list.scrollHeight - list.clientHeight,
        ),
      );
    const to = endpoint();
    const distance = to - from;
    if (!smooth || reduced() || Math.abs(distance) < 2) {
      list.scrollTo({ top: to, behavior: 'instant' });
      arrived?.();
      return;
    }
    const start = performance.now();
    // Even a jump across a long history finishes promptly.
    const duration = Math.min(420, 240 + Math.abs(distance) * 0.08);
    const step = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - start) / duration));
      list.scrollTo({
        top: from + (endpoint() - from) * (1 - (1 - progress) ** 3),
        behavior: 'instant',
      });
      if (progress < 1) frame = requestAnimationFrame(step);
      else {
        frame = 0;
        arrived?.();
      }
    };
    frame = requestAnimationFrame(step);
  };
  const interrupt = () => {
    cancel();
    onInterrupt?.();
  };
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
    list.addEventListener(event, interrupt, { passive: true });
  return {
    get scrolling() {
      return frame !== 0;
    },
    jump(target: HTMLElement) {
      if (disposed || !list.contains(target)) return false;
      const bounds = target.getBoundingClientRect();
      const top =
        list.scrollTop +
        bounds.top -
        list.getBoundingClientRect().top -
        list.clientTop;
      // Tall media starts at the top instead of hiding its beginning above the list.
      move(
        top - Math.max(0, (list.clientHeight - bounds.height) / 2),
        true,
        () => emphasize(target),
      );
      target.focus({ preventScroll: true });
      return true;
    },
    bottom(smooth = false) {
      move(() => list.scrollHeight, smooth);
    },
    cancel,
    dispose() {
      disposed = true;
      cancel();
      for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
        list.removeEventListener(event, interrupt);
    },
  };
}
