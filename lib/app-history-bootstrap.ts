export type AppHistoryHost = Window & {
  __noctgramHistory?: { listener: ((event: PopStateEvent) => void) | null };
};

// Native Window popstate listeners run in registration order, including capture
// listeners. Install this relay before the framework boots; the mounted app owns
// only its own entries and leaves account pages / external navigation untouched.
export const APP_HISTORY_BOOTSTRAP = `(() => {
  if (window.__noctgramHistory) return;
  const bridge = window.__noctgramHistory = { listener: null };
  window.addEventListener('popstate', event => bridge.listener?.(event));
})();`;
