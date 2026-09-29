// Shared by the server and the browser: no storage imports here.
export const GENERAL_TOPIC = 'general';
export const GENERAL_TOPIC_TITLE = 'Общее';
export const TOPIC_LIMIT = 100;
export const TOPIC_TITLE_LIMIT = 128;
// Telegram's six topic icon colours, in the order clients store them.
export const TOPIC_COLORS = [
  '#6fb9f0',
  '#ffd67e',
  '#cb86db',
  '#8eee98',
  '#ff93b2',
  '#fb6f5f',
] as const;
export const TOPIC_EMOJI = [
  '💬',
  '📌',
  '🎬',
  '🎮',
  '🎵',
  '📚',
  '💡',
  '🔥',
  '🎉',
  '⚽',
  '🍕',
  '🛠',
];
export type RoomTopic = {
  id: string;
  title: string;
  color: number;
  emoji: string;
  createdBy: string;
  created: number;
  updatedAt: number;
  closedAt: number;
  unread: number;
  lastMessage: {
    id: string;
    text: string;
    created: number;
    sender: string;
    senderName: string;
  } | null;
};
