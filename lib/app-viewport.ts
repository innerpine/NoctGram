/** The keyboard shrinks Safari's visual viewport without resizing 100dvh.
 * Keep zoom gestures native; only follow the visible area at normal scale. */
export function observeAppViewport(host: Window = window) {
  const doc = host.document;
  const root = doc.documentElement;
  const viewport = host.visualViewport;
  let frame = 0;
  let baselineHeight = Math.max(host.innerHeight, root.clientHeight);
  let baselineWidth = viewport?.width;
  let keyboardOpen = false;
  const properties = [
    '--app-viewport-height',
    '--app-viewport-width',
    '--app-viewport-top',
    '--app-keyboard-inset',
  ];
  const clear = () => {
    for (const property of properties) root.style.removeProperty(property);
    delete root.dataset.keyboardOpen;
  };
  const update = () => {
    frame = 0;
    if (!viewport || Math.abs(viewport.scale - 1) > 0.01) {
      clear();
      return;
    }
    const input = doc.activeElement;
    const editing = input?.matches(
      'textarea, input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="file"]), [contenteditable="true"]',
    );
    const layoutHeight = Math.max(host.innerHeight, root.clientHeight);
    // Android can resize both viewports. Keep the pre-keyboard height until it
    // returns, including the closing animation after the input loses focus.
    const touch = host.matchMedia('(pointer: coarse)').matches;
    if (
      Math.abs((baselineWidth ?? viewport.width) - viewport.width) > 1 ||
      (!editing && !keyboardOpen) ||
      !touch
    )
      baselineHeight = layoutHeight;
    baselineWidth = viewport.width;
    baselineHeight = Math.max(baselineHeight, layoutHeight, viewport.height);
    const covered = Math.max(0, baselineHeight - viewport.height);
    const inset = touch && (editing || keyboardOpen) ? covered : 0;
    keyboardOpen = inset > 1;
    if (!keyboardOpen) baselineHeight = layoutHeight;
    root.style.setProperty(properties[0], `${viewport.height}px`);
    root.style.setProperty(properties[1], `${viewport.width}px`);
    root.style.setProperty(properties[2], `${viewport.offsetTop}px`);
    root.style.setProperty(properties[3], `${inset}px`);
    root.dataset.keyboardOpen = keyboardOpen ? 'true' : 'false';
  };
  const schedule = () => {
    if (!frame) frame = host.requestAnimationFrame(update);
  };
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  host.addEventListener('resize', schedule);
  // Safari's collapsing toolbar can change the visible area during a document
  // scroll without delivering a VisualViewport resize in the same frame.
  host.addEventListener('scroll', schedule, { passive: true });
  host.addEventListener('pageshow', schedule);
  doc.addEventListener('visibilitychange', schedule);
  doc.addEventListener('focusin', schedule);
  doc.addEventListener('focusout', schedule);
  update();
  return () => {
    host.cancelAnimationFrame(frame);
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    host.removeEventListener('resize', schedule);
    host.removeEventListener('scroll', schedule);
    host.removeEventListener('pageshow', schedule);
    doc.removeEventListener('visibilitychange', schedule);
    doc.removeEventListener('focusin', schedule);
    doc.removeEventListener('focusout', schedule);
    clear();
  };
}
