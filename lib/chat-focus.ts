// A message to open once its chat is shown, e.g. a chosen search result. An
// already open chat hears about it through the event.
export const CHAT_FOCUS_EVENT = 'noctgram:chat-focus';
let pending: { chat: string; id: string } | null = null;
export function requestChatFocus(chat: string, id: string) {
  pending = { chat, id };
  window.dispatchEvent(new Event(CHAT_FOCUS_EVENT));
}
export function takeChatFocus(chat: string) {
  if (!pending || pending.chat !== chat) return '';
  const { id } = pending;
  pending = null;
  return id;
}
