export const CURSOR_STORAGE_KEY = 'noct-custom-cursor';

// Apply the saved choice before paint, including on pages opened in a new tab.
export const CURSOR_BOOTSTRAP = `(() => {
  try {
    document.documentElement.dataset.noctCursor = localStorage.getItem(${JSON.stringify(CURSOR_STORAGE_KEY)}) === 'off' ? 'off' : 'on';
  } catch { /* The CSS default remains enabled when storage is unavailable. */ }
})();`;

const listeners = new Set<() => void>();
export const cursorServerSnapshot = () => true;
export const cursorSnapshot = () =>
  document.documentElement.dataset.noctCursor !== 'off';
export function subscribeCursor(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function apply(value: boolean) {
  document.documentElement.dataset.noctCursor = value ? 'on' : 'off';
  listeners.forEach((listener) => listener());
}
function refresh() {
  try {
    apply(localStorage.getItem(CURSOR_STORAGE_KEY) !== 'off');
  } catch {
    // Keep this tab's choice if the browser blocks persistent storage.
  }
}
export function syncCursorPreference() {
  refresh();
  const storage = (event: StorageEvent) => {
    if (event.key === CURSOR_STORAGE_KEY || event.key === null) refresh();
  };
  window.addEventListener('storage', storage);
  return () => window.removeEventListener('storage', storage);
}
export function setCursorPreference(value: boolean) {
  try {
    localStorage.setItem(CURSOR_STORAGE_KEY, value ? 'on' : 'off');
  } catch {
    // The switch still works for the current tab.
  }
  apply(value);
}
