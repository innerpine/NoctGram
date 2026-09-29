// Shows a toast from components that do not own the app's notification state.
export const APP_NOTICE_EVENT = 'noctgram:notify';
export function appNotice(text: string) {
  window.dispatchEvent(new CustomEvent(APP_NOTICE_EVENT, { detail: { text } }));
}
