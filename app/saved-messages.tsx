'use client';
import { Bookmark } from 'lucide-react';

// «Избранное» is the chat with yourself, drawn like Telegram's Saved Messages.
export const SAVED_MESSAGES = 'Избранное';
export function SavedMessagesAvatar({ size = 38 }: { size?: number }) {
  return (
    <span
      className="saved-avatar"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Bookmark size={Math.round(size * 0.46)} fill="currentColor" />
    </span>
  );
}
