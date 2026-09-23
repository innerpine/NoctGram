type TailOptions = {
  following: { current: boolean };
  busy: () => boolean;
  bottom: () => void;
};

/** Layout scroll events are not user intent. Keep the end visible through late
 * media/font loads and composer resizes, until the reader deliberately scrolls. */
export function watchChatTail(
  list: HTMLElement,
  content: HTMLElement,
  options: TailOptions,
) {
  const sync = () => {
    if (options.following.current && !options.busy()) options.bottom();
  };
  const release = () => {
    options.following.current = false;
  };
  const wheel = (event: WheelEvent) => {
    if (event.deltaY) release();
  };
  const pointer = (event: PointerEvent) => {
    // A scrollbar drag has no wheel event. Text clicks don't detach the tail.
    if (
      event.clientX >=
      list.getBoundingClientRect().left + list.clientLeft + list.clientWidth
    )
      release();
  };
  const key = (event: KeyboardEvent) => {
    if (
      [
        'ArrowUp',
        'ArrowDown',
        'PageUp',
        'PageDown',
        'Home',
        'End',
        ' ',
      ].includes(event.key) &&
      !(
        event.target instanceof Element &&
        event.target.closest(
          'input, textarea, button, [contenteditable="true"]',
        )
      )
    )
      release();
  };
  const scroll = () => {
    if (
      !options.busy() &&
      list.scrollHeight - list.scrollTop - list.clientHeight <= 2
    )
      options.following.current = true;
  };
  const resize = new ResizeObserver(sync);
  resize.observe(list);
  resize.observe(content);
  list.addEventListener('wheel', wheel, { passive: true });
  list.addEventListener('touchmove', release, { passive: true });
  list.addEventListener('pointerdown', pointer, { passive: true });
  list.addEventListener('keydown', key);
  list.addEventListener('scroll', scroll, { passive: true });
  return () => {
    resize.disconnect();
    list.removeEventListener('wheel', wheel);
    list.removeEventListener('touchmove', release);
    list.removeEventListener('pointerdown', pointer);
    list.removeEventListener('keydown', key);
    list.removeEventListener('scroll', scroll);
  };
}

/** Called once when the conversation is ready, not while its request is pending. */
export function revealChat(list: HTMLElement) {
  const panel = list.closest<HTMLElement>('.chat-panel');
  if (!panel?.animate) return () => {};
  // Reduced motion keeps a short fade; the panel no longer slides in.
  const animation = window.matchMedia('(prefers-reduced-motion: reduce)')
    .matches
    ? panel.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 150,
        easing: 'ease',
      })
    : panel.animate(
        [
          { opacity: 0, translate: '32px 0' },
          { opacity: 1, translate: '0 0' },
        ],
        { duration: 360, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
  return () => animation.cancel();
}
