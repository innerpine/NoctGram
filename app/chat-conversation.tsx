'use client';
/* eslint-disable react/react-compiler */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Forward, Trash2, X } from 'lucide-react';
import type { Message, Person } from '@/lib/client';
import { chatRequest } from '@/lib/chat-client';
import { messageSummary } from '@/lib/chat-message-display';
import { createChatNavigator } from '@/lib/chat-navigation';
import { createChatDragSelection } from '@/lib/chat-drag-selection';
import { createChatRemoval } from '@/lib/chat-removal';
import { ChatReveal } from './chat-reveal';
import { ChatPins } from './chat-pins';
import { ChatMessage } from './chat-message';
import { ChatComposer } from './chat-composer';
import { chatHistoryContextMenu, type ChatAction } from './chat-message-menu';
import {
  ChatDeleteDialog,
  ChatEditDialog,
  ChatForwardDialog,
} from './chat-action-dialogs';

export function ChatConversation({
  messages,
  me,
  peer,
  threads,
  text,
  onText,
  disabled,
  canSend,
  privacyNote,
  onRefresh,
  onFocus,
  onProfile,
  onReport,
  notify,
}: {
  messages: Message[];
  me: Person;
  peer: Person;
  threads: Person[];
  text: string;
  onText: (text: string) => void;
  disabled: boolean;
  canSend: boolean;
  privacyNote: string;
  onRefresh: () => Promise<unknown>;
  onFocus: (id: string) => Promise<unknown>;
  onProfile: (id: string) => void;
  onReport: (message: Message) => void;
  notify: (text: string) => void;
}) {
  const [initialMessages] = useState(
    () => new Set(messages.map((message) => message.id)),
  );
  const [reply, setReply] = useState<Message | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [composerLocked, setComposerLocked] = useState(false),
    [working, setWorking] = useState(false);
  const [operation, setOperation] = useState<{
    type: 'delete' | 'forward' | 'edit';
    messages: Message[];
  } | null>(null);
  const [, updateRemoval] = useState(0);
  const list = useRef<HTMLDivElement>(null),
    removal = useRef<ReturnType<typeof createChatRemoval> | null>(null),
    dragSelection = useRef<ReturnType<typeof createChatDragSelection> | null>(
      null,
    ),
    navigation = useRef<ReturnType<typeof createChatNavigator> | null>(null),
    followTail = useRef(true),
    previousNewest = useRef<Message | undefined>(undefined),
    jumpVersion = useRef(0),
    jumpFrame = useRef(0),
    pendingJump = useRef(''),
    pinLock = useRef(false),
    alive = useRef(true);
  const selectionRef = useRef(selected);
  selectionRef.current = selected;
  useLayoutEffect(() => {
    alive.current = true;
    if (list.current)
      removal.current = createChatRemoval(list.current, () =>
        updateRemoval((value) => value + 1),
      );
    navigation.current = list.current
      ? createChatNavigator(list.current, () => {
          pendingJump.current = '';
          jumpVersion.current++;
          cancelAnimationFrame(jumpFrame.current);
        })
      : null;
    if (list.current)
      dragSelection.current = createChatDragSelection(list.current, {
        selected: () => selectionRef.current,
        select: (ids) => {
          selectionRef.current = ids;
          setSelected(ids);
        },
        start: () => {
          navigation.current?.cancel();
          pendingJump.current = '';
          jumpVersion.current++;
          followTail.current = false;
        },
        limit: () => latest.current.notify('Можно выделить до 20 сообщений'),
      });
    const resize = new ResizeObserver(() => {
      if (
        followTail.current &&
        !navigation.current?.scrolling &&
        !dragSelection.current?.dragging
      )
        navigation.current?.bottom();
    });
    if (list.current) resize.observe(list.current);
    return () => {
      alive.current = false;
      cancelAnimationFrame(jumpFrame.current);
      navigation.current?.dispose();
      navigation.current = null;
      resize.disconnect();
      dragSelection.current?.dispose();
      dragSelection.current = null;
      removal.current?.dispose();
      removal.current = null;
    };
  }, []);
  const latest = useRef({ onFocus, notify });
  latest.current = { onFocus, notify };
  const jumpHere = (id: string) => {
    const target = document.getElementById('chat-message-' + id);
    if (!target || !list.current?.contains(target)) return false;
    return navigation.current?.jump(target) ?? false;
  };
  const onJump = useCallback((id: string) => {
    const version = ++jumpVersion.current;
    cancelAnimationFrame(jumpFrame.current);
    pendingJump.current = '';
    followTail.current = false;
    if (jumpHere(id)) return;
    navigation.current?.cancel();
    pendingJump.current = id;
    void latest.current
      .onFocus(id)
      .then(() => {
        // The message effect may already have handled the fetched target.
        if (
          alive.current &&
          pendingJump.current === id &&
          jumpVersion.current === version
        )
          jumpFrame.current = requestAnimationFrame(() => {
            if (
              alive.current &&
              pendingJump.current === id &&
              jumpVersion.current === version
            ) {
              const found = jumpHere(id);
              pendingJump.current = '';
              if (!found) latest.current.notify('Сообщение больше недоступно');
            }
          });
      })
      .catch((error) => {
        if (
          alive.current &&
          jumpVersion.current === version &&
          pendingJump.current === id
        ) {
          pendingJump.current = '';
          latest.current.notify(error.message);
        }
      });
  }, []);
  const last = messages.at(-1);
  useLayoutEffect(() => {
    const previous = previousNewest.current;
    if (last?.id === previous?.id) return;
    previousNewest.current = last;
    if (!last || pendingJump.current || dragSelection.current?.dragging) return;
    if (
      !previous ||
      (last.created >= previous.created &&
        (followTail.current || last.sender === me.id))
    ) {
      followTail.current = true;
      navigation.current?.bottom(!!previous);
    }
  }, [last, me.id]);
  useEffect(() => {
    if (pendingJump.current && jumpHere(pendingJump.current))
      pendingJump.current = '';
    setSelected((previous) =>
      previous.every((id) => messages.some((message) => message.id === id))
        ? previous
        : previous.filter((id) =>
            messages.some((message) => message.id === id),
          ),
    );
  }, [messages]);
  const selectedMessages = messages.filter((message) =>
    selected.includes(message.id),
  );
  const action = useRef<(action: ChatAction, message: Message) => void>(
    () => {},
  );
  action.current = (kind, message) => {
    if (removal.current?.has(message.id)) return;
    if (kind === 'copy') {
      void navigator.clipboard
        .writeText(message.text)
        .then(() => notify('Текст скопирован'))
        .catch(() => notify('Не удалось скопировать текст'));
      return;
    }
    if (kind === 'report') {
      onReport(message);
      return;
    }
    if (kind === 'select') {
      if (!selected.includes(message.id) && selected.length >= 20) {
        notify('Можно выделить до 20 сообщений');
        return;
      }
      setSelected((previous) =>
        previous.includes(message.id)
          ? previous.filter((id) => id !== message.id)
          : [...previous, message.id],
      );
      return;
    }
    if (disabled || working || composerLocked) return;
    if (kind === 'reply') {
      if (canSend) {
        setReply(message);
        setSelected([]);
      }
      return;
    }
    if (kind === 'pin') {
      if (!canSend || pinLock.current) return;
      pinLock.current = true;
      setWorking(true);
      void chatRequest('/api/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'messagePin',
          peer: peer.id,
          id: message.id,
          value: !message.pinnedAt,
        }),
        signal: AbortSignal.timeout(15000),
      })
        .then(onRefresh)
        .catch((error) => {
          if (alive.current) notify(error.message);
        })
        .finally(() => {
          pinLock.current = false;
          if (alive.current) setWorking(false);
        });
      return;
    }
    if (kind === 'edit' || kind === 'delete' || kind === 'forward')
      setOperation({ type: kind, messages: [message] });
  };
  const onAction = useCallback(
    (kind: ChatAction, message: Message) => action.current(kind, message),
    [],
  );
  const onPin = useCallback(
    (message: Message) => onAction('pin', message),
    [onAction],
  );
  const finished = () => {
    if (operation?.type === 'delete') {
      removal.current?.remove(operation.messages);
      if (
        reply &&
        operation.messages.some((message) => message.id === reply.id)
      )
        setReply(null);
      setSelected([]);
    }
    if (operation?.type === 'forward') {
      setSelected([]);
      notify('Сообщения пересланы');
    }
    void onRefresh().catch((error) => notify(error.message));
  };
  const readonly = disabled || working || composerLocked;
  const visibleMessages = removal.current?.visible(messages) ?? messages;
  return (
    <div className="chat-conversation">
      <ChatPins
        messages={messages}
        disabled={readonly || !canSend}
        onPin={onPin}
        onJump={onJump}
      />
      <ChatReveal>
        {selectedMessages.length > 0 && (
          <div className="chat-selection-bar">
            <button
              className="icon-button"
              aria-label="Снять выделение"
              onClick={() => setSelected([])}
            >
              <X size={18} />
            </button>
            <strong>Выбрано · {selectedMessages.length}</strong>
            <button
              disabled={readonly}
              aria-label="Переслать выбранные сообщения"
              onClick={() =>
                setOperation({ type: 'forward', messages: selectedMessages })
              }
            >
              <Forward size={18} />
              <span>Переслать</span>
            </button>
            <button
              disabled={readonly}
              aria-label="Удалить выбранные сообщения"
              onClick={() =>
                setOperation({ type: 'delete', messages: selectedMessages })
              }
            >
              <Trash2 size={18} />
              <span>Удалить</span>
            </button>
          </div>
        )}
      </ChatReveal>
      <div
        className="message-list"
        ref={list}
        onContextMenu={chatHistoryContextMenu}
        onScroll={() => {
          if (
            list.current &&
            !navigation.current?.scrolling &&
            !dragSelection.current?.dragging
          )
            followTail.current =
              list.current.scrollHeight -
                list.current.scrollTop -
                list.current.clientHeight <
              64;
        }}
      >
        {!visibleMessages.length && (
          <p className="chat-empty-history">Здесь начинается ваш разговор.</p>
        )}
        {visibleMessages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            initial={initialMessages.has(message.id)}
            me={me}
            peer={peer}
            disabled={readonly}
            canSend={canSend}
            onProfile={onProfile}
            onReport={onReport}
            onAction={onAction}
            onJump={onJump}
            selected={selected.includes(message.id)}
            selecting={selectedMessages.length > 0}
            removing={removal.current?.has(message.id) ?? false}
          />
        ))}
      </div>
      {!!privacyNote && <p className="message-privacy-note">{privacyNote}</p>}
      <ChatComposer
        peerId={peer.id}
        text={text}
        onText={onText}
        disabled={disabled || working || !canSend}
        reply={
          reply
            ? {
                id: reply.id,
                name: reply.sender === me.id ? 'Вы' : peer.name,
                text: messageSummary(reply),
              }
            : null
        }
        onCancelReply={() => setReply(null)}
        onLockedChange={setComposerLocked}
        onSent={() => {
          followTail.current = true;
          void onRefresh().catch((error) => notify(error.message));
        }}
      />
      {operation?.type === 'delete' && (
        <ChatDeleteDialog
          messages={operation.messages}
          peer={peer}
          onClose={() => setOperation(null)}
          onDone={finished}
        />
      )}
      {operation?.type === 'edit' && (
        <ChatEditDialog
          message={operation.messages[0]}
          peer={peer}
          onClose={() => setOperation(null)}
          onDone={finished}
        />
      )}
      {operation?.type === 'forward' && (
        <ChatForwardDialog
          messages={operation.messages}
          me={me}
          peer={peer}
          threads={threads}
          onClose={() => setOperation(null)}
          onDone={finished}
        />
      )}
    </div>
  );
}
