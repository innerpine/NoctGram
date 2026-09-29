'use client';
import { memo, useRef, useState } from 'react';
import {
  Check,
  Clock3,
  Forward,
  MessageCircle,
  MoreHorizontal,
  Quote,
  Reply,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ReactionEmoji } from '@/lib/message-reactions';
import type { RoomKind, RoomMessage } from '@/lib/rooms-types';
import type { RoomOutgoing } from '@/lib/room-outbox';
import { RoomMessageGesture } from './room-message-gesture';
import { MessageReactions } from './message-reactions';
import { GiveawayCard } from './giveaway-card';
import { ChatEmojiText } from './chat-emoji-text';
import { ChatMessageFiles } from './chat-message-files';
import {
  forwardedHeader,
  messageLayout,
  replyQuote,
  sharedPost,
} from './message-body';
import { locallyListened, markLocallyListened } from '@/lib/media-playback';
import { selectionQuote } from '@/lib/message-selection';
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

export const RoomMessageRow = memo(function RoomMessageRow({
  message,
  roomKind,
  meId,
  content,
  interactive,
  canReply,
  canDelete,
  canForward = false,
  reactionsDisabled,
  reactionPending,
  delivery,
  onReply,
  onQuote,
  onForward,
  onDelete,
  onProfile,
  onJump,
  onReact,
  onRetry,
  onThread,
}: {
  message: RoomMessage;
  roomKind: RoomKind;
  meId: string;
  // Text to show: decrypted text in secret chats, a placeholder when deleted.
  content: string;
  interactive: boolean;
  canReply: boolean;
  canDelete: boolean;
  canForward?: boolean;
  reactionsDisabled: boolean;
  reactionPending: boolean;
  delivery?: RoomOutgoing;
  onReply: (message: RoomMessage) => void;
  onQuote?: (message: RoomMessage, quote: string) => void;
  onForward?: (message: RoomMessage) => void;
  onDelete: (message: RoomMessage) => void;
  onProfile: (id: string) => void;
  onJump: (id: string) => void;
  onReact: (message: RoomMessage, emoji: ReactionEmoji | null) => Promise<void>;
  onRetry: (id: string) => void;
  // Opens the reply thread this message starts or belongs to.
  onThread?: (message: RoomMessage) => void;
}) {
  const self = message.sender === meId;
  const deleted = !!message.deletedAt;
  const bubble = useRef<HTMLDivElement>(null);
  // Text selected when the menu opens becomes a quote reply.
  const [quote, setQuote] = useState('');
  const group = roomKind === 'group';
  const giveawayEvent = !!message.giveawayId && !deleted;
  const attachments = deleted ? [] : (message.attachments ?? []);
  const { emojiCount, visualMedia, mediaOnly, round, voice } = messageLayout({
    text: deleted ? '' : content,
    attachments,
    reply: message.reply,
    forwardedName: message.forwardedName,
    postShare: message.postShare,
  });
  const stamp = (
    <span className="room-message-time">
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
    <RoomMessageGesture
      enabled={interactive}
      onReply={() => onReply(message)}
      className={
        giveawayEvent
          ? 'room-giveaway-event'
          : 'room-message ' + (self ? 'self' : 'other')
      }
    >
      {!giveawayEvent && !self && group && (
        <button
          className="room-message-avatar"
          aria-label={'Профиль ' + message.senderName}
          onClick={() => onProfile(message.sender)}
        >
          <Avatar
            person={{ name: message.senderName, avatar: message.senderAvatar }}
            size={28}
          />
        </button>
      )}
      <div
        ref={bubble}
        id={'room-message-' + message.id}
        tabIndex={-1}
        data-delivery={delivery?.status}
        className={
          giveawayEvent
            ? 'room-giveaway-content'
            : 'room-bubble' +
              (deleted ? ' deleted' : '') +
              (emojiCount ? ' room-emoji-only' : '') +
              (visualMedia ? ' room-media-message' : '') +
              (mediaOnly ? ' room-media-only' : '') +
              (round ? ' room-round-message' : '') +
              (voice ? ' room-voice-message' : '')
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
        {!deleted && forwardedHeader(message.forwardedName, message.forwardedFrom)}
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
        {giveawayEvent ? (
          <GiveawayCard id={message.giveawayId!} viewerId={meId} />
        ) : (
          (deleted || !!content.trim()) && (
            <p className="chat-message-text">
              <ChatEmojiText text={content} large={!!emojiCount} />
            </p>
          )
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
            disabled={reactionsDisabled || !!delivery}
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
            <span className="room-message-time">
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
            title={delivery.error}
            onClick={() => onRetry(message.id)}
          >
            <RotateCcw size={14} /> Повторить отправку
          </button>
        )}
      </div>
      {!deleted && !delivery && (canReply || canDelete || canForward) && (
        <DropdownMenu>
          <DropdownMenuTrigger
            onPointerDown={() =>
              setQuote(
                canReply && group
                  ? selectionQuote(
                      bubble.current?.querySelector('.chat-message-text'),
                      message.text,
                    )
                  : '',
              )
            }
            className="room-message-more icon-button"
            aria-label={
              giveawayEvent ? 'Действия с розыгрышем' : 'Действия с сообщением'
            }
          >
            <MoreHorizontal size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="chat-options-menu" align="end">
            {canReply && (
              <DropdownMenuItem
                disabled={!interactive}
                onClick={() => onReply(message)}
              >
                <Reply size={15} />
                Ответить
              </DropdownMenuItem>
            )}
            {canReply && !!quote && (
              <DropdownMenuItem
                disabled={!interactive}
                onClick={() => onQuote?.(message, quote)}
              >
                <Quote size={15} />
                Ответить с цитатой
              </DropdownMenuItem>
            )}
            {onThread && (!!message.replies || !!message.threadRootId) && (
              <DropdownMenuItem onClick={() => onThread(message)}>
                <MessageCircle size={15} />
                Открыть ветку
              </DropdownMenuItem>
            )}
            {canForward && !giveawayEvent && (
              <DropdownMenuItem onClick={() => onForward?.(message)}>
                <Forward size={15} />
                Переслать
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onDelete(message)}
              >
                <Trash2 size={15} />
                Удалить у всех
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </RoomMessageGesture>
  );
});
