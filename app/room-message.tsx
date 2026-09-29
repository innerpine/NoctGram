'use client';
import { memo } from 'react';
import { Check, Clock3, MessageCircle, RotateCcw } from 'lucide-react';
import type { ReactionEmoji } from '@/lib/message-reactions';
import type { RoomKind, RoomMessage, RoomRole } from '@/lib/rooms-types';
import type { RoomOutgoing } from '@/lib/room-outbox';
import { RoomMessageContext } from './room-message-menu';
import { MessageReactions } from './message-reactions';
import { GiveawayCard } from './giveaway-card';
import { ChatEmojiText } from './chat-emoji-text';
import { ChatMessageFiles } from './chat-message-files';
import { MusicLinkCard } from './music-link-card';
import {
  forwardedHeader,
  messageLayout,
  replyQuote,
  sharedPost,
  stickerContent,
} from './message-body';
import { locallyListened, markLocallyListened } from '@/lib/media-playback';
import { Avatar } from './post-card';

export function repliesLabel(count: number) {
  const form = new Intl.PluralRules('ru').select(count);
  return (
    count +
    ' ' +
    (form === 'one' ? 'ответ' : form === 'few' ? 'ответа' : 'ответов')
  );
}
const time = (date: number) =>
  new Date(date).toLocaleTimeString('ru', {
    hour: '2-digit',
    minute: '2-digit',
  });

// A group or secret chat message, styled like direct chats. Right click, long
// press or the «…» button open one context menu with reactions and actions.
export const RoomMessageRow = memo(function RoomMessageRow({
  message,
  roomKind,
  role,
  meId,
  content,
  disabled,
  canSend,
  canReply = true,
  pending,
  reactionPending,
  delivery,
  initial = true,
  onReply,
  onQuote,
  onForward,
  onDelete,
  onCopy,
  onProfile,
  onJump,
  onReact,
  onRetry,
  onThread,
}: {
  message: RoomMessage;
  roomKind: RoomKind;
  role: RoomRole;
  meId: string;
  // Text to show: decrypted text in secret chats, a placeholder when deleted.
  content: string;
  // Replies, reactions and deletion are locked (restrictions, closed topic).
  disabled: boolean;
  canSend: boolean;
  canReply?: boolean;
  pending: boolean;
  reactionPending: boolean;
  delivery?: RoomOutgoing;
  // Rows already on screen do not replay their entrance.
  initial?: boolean;
  onReply: (message: RoomMessage) => void;
  onQuote?: (message: RoomMessage, quote: string) => void;
  onForward?: (message: RoomMessage) => void;
  onDelete: (message: RoomMessage) => void;
  onCopy: (message: RoomMessage) => void;
  onProfile: (id: string) => void;
  onJump: (id: string) => void;
  onReact: (message: RoomMessage, emoji: ReactionEmoji | null) => Promise<void>;
  onRetry: (id: string) => void;
  // Opens the reply thread this message starts or belongs to.
  onThread?: (message: RoomMessage) => void;
}) {
  const self = message.sender === meId;
  const deleted = !!message.deletedAt;
  const group = roomKind === 'group';
  const giveawayEvent = !!message.giveawayId && !deleted;
  const attachments = deleted ? [] : (message.attachments ?? []);
  const { emojiCount, visualMedia, mediaOnly, round, voice, sticker } =
    messageLayout({
      text: deleted ? '' : content,
      attachments,
      reply: message.reply,
      forwardedName: message.forwardedName,
      postShare: message.postShare,
      sticker: deleted ? undefined : message.sticker,
    });
  const stamp = (
    <span className="message-time">
      {time(message.created)}
      {self &&
        (delivery && delivery.status !== 'sent' ? (
          <Clock3 size={12} aria-label="Отправляется" />
        ) : (
          <Check size={12} />
        ))}
    </span>
  );
  return (
    <RoomMessageContext
      message={message}
      kind={roomKind}
      role={role}
      own={self}
      disabled={disabled}
      canSend={canSend}
      pending={pending}
      unconfirmed={!!delivery}
      canReply={canReply}
      initial={initial}
      reactionPending={reactionPending}
      onReact={onReact}
      onReply={onReply}
      onQuote={onQuote}
      onThread={onThread}
      onForward={onForward}
      onRemove={onDelete}
      onCopy={() => onCopy(message)}
      className={
        giveawayEvent
          ? 'room-giveaway-event'
          : 'chat-message-row ' + (self ? 'self' : 'other')
      }
    >
      {!giveawayEvent && (
        <button
          className="chat-message-avatar"
          aria-label={'Профиль ' + message.senderName}
          onClick={() => onProfile(message.sender)}
        >
          <Avatar
            person={{ name: message.senderName, avatar: message.senderAvatar }}
            size={32}
          />
        </button>
      )}
      <div
        id={'room-message-' + message.id}
        tabIndex={-1}
        data-delivery={delivery?.status}
        className={
          giveawayEvent
            ? 'room-giveaway-content'
            : 'bubble ' +
              (self ? 'self' : 'other') +
              (deleted ? ' deleted' : '') +
              (emojiCount ? ' chat-emoji-only' : '') +
              (visualMedia ? ' chat-media-message' : '') +
              (mediaOnly ? ' chat-media-only' : '') +
              (round ? ' chat-round-message' : '') +
              (voice ? ' chat-voice-message' : '') +
              (sticker ? ' chat-sticker-message' : '')
        }
        data-emoji-count={emojiCount || undefined}
      >
        {!giveawayEvent && !self && group && (
          <button
            className="room-sender"
            onClick={() => onProfile(message.sender)}
          >
            {message.senderName}
          </button>
        )}
        {!deleted &&
          forwardedHeader(message.forwardedName, message.forwardedFrom)}
        {!deleted && replyQuote(message.reply, meId, onJump)}
        {!!attachments.length && (
          <ChatMessageFiles
            files={attachments}
            flush={visualMedia}
            metadata={mediaOnly ? stamp : undefined}
            own={self}
            listened={self || !!delivery || locallyListened(message.id)}
            onListened={() => markLocallyListened(message.id)}
          />
        )}
        {!deleted && sharedPost(message.postShare, meId)}
        {!deleted && stickerContent(message.sticker)}
        {giveawayEvent ? (
          <GiveawayCard id={message.giveawayId!} viewerId={meId} />
        ) : (
          (deleted || !!content.trim()) && (
            <p className="chat-message-text">
              <ChatEmojiText text={content} large={!!emojiCount} />
            </p>
          )
        )}
        {group && !deleted && !giveawayEvent && (
          <div className="chat-message-music" data-chat-menu-exempt>
            <MusicLinkCard text={content} />
          </div>
        )}
        {group && !deleted && !!message.replies && onThread && (
          <button
            type="button"
            className="room-thread-chip"
            onClick={() => onThread(message)}
          >
            <MessageCircle size={14} />
            {repliesLabel(message.replies)}
          </button>
        )}
        {group && !deleted && (
          <MessageReactions
            reactions={message.reactions}
            disabled={disabled || !canSend || pending || !!delivery}
            pending={reactionPending}
            onReact={(emoji) => onReact(message, emoji)}
          />
        )}
        {giveawayEvent ? (
          <div className="room-giveaway-meta">
            <button
              className="room-giveaway-organizer"
              aria-label={'Организатор: ' + message.senderName}
              onClick={() => onProfile(message.sender)}
            >
              {message.senderName}
            </button>
            <span aria-hidden="true">·</span>
            <span className="message-time">
              <time dateTime={new Date(message.created).toISOString()}>
                {time(message.created)}
              </time>
            </span>
          </div>
        ) : (
          !mediaOnly && stamp
        )}
        {delivery?.status === 'failed' && (
          <button
            type="button"
            className="chat-delivery-retry"
            data-chat-menu-exempt
            title={delivery.error}
            onClick={() => onRetry(message.id)}
          >
            <RotateCcw size={14} /> Повторить отправку
          </button>
        )}
      </div>
    </RoomMessageContext>
  );
});
