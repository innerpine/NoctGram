/** The keyboard shrinks Safari's visual viewport without resizing 100dvh.
 * Keep zoom gestures native; only follow the visible area at normal scale. */
export function observeAppViewport(host: Window = window) {
  const doc = host.document;
  const root = doc.documentElement;
  const viewport = host.visualViewport;
  let frame = 0;
  const properties = [
    '--app-viewport-height',
    '--app-viewport-width',
    '--app-viewport-top',
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
    root.style.setProperty(properties[0], `${viewport.height}px`);
    root.style.setProperty(properties[1], `${viewport.width}px`);
    root.style.setProperty(properties[2], `${viewport.offsetTop}px`);
    const input = doc.activeElement;
    const editing = input?.matches(
      'textarea, input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="file"]), [contenteditable="true"]',
    );
    const covered =
      Math.max(host.innerHeight, root.clientHeight) - viewport.height;
    root.dataset.keyboardOpen = editing && covered > 120 ? 'true' : 'false';
  };
  const schedule = () => {
    if (!frame) frame = host.requestAnimationFrame(update);
  };
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  host.addEventListener('resize', schedule);
  doc.addEventListener('focusin', schedule);
  doc.addEventListener('focusout', schedule);
  update();
  return () => {
    host.cancelAnimationFrame(frame);
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    host.removeEventListener('resize', schedule);
    doc.removeEventListener('focusin', schedule);
    doc.removeEventListener('focusout', schedule);
    clear();
  };
}
