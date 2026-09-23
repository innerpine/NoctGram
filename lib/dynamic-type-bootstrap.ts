// iOS "Larger Text" only reaches the page through the -apple-system-body font.
// Scale the rem base from it before first paint: the default 17px body keeps
// today's 16px. macOS Safari also knows the keyword (13px there), so touch only.
// Capped at xxxLarge (23px): the accessibility sizes would break the fixed
// bar heights of this compact layout.
export const DYNAMIC_TYPE_BOOTSTRAP = `(() => {
  try {
    if (!CSS.supports('font', '-apple-system-body') || !(navigator.maxTouchPoints > 0)) return;
    const root = document.documentElement;
    const probe = document.createElement('i');
    probe.style.font = '-apple-system-body';
    root.appendChild(probe);
    const body = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    if (body > 0) root.style.fontSize = (16 * Math.min(body, 23)) / 17 + 'px';
  } catch {}
})();`;
