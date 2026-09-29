'use client';
/* eslint-disable react/react-compiler */
import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Message, Person } from '@/lib/client';
import { useDialogMutation as useMutation } from './chat-dialog-mutation';
import { ChatTextEditor } from './chat-text-editor';

type Shared = { peer: Person; onClose: () => void; onDone: () => void };
export function ChatDeleteDialog({
  messages,
  peer,
  saved = false,
  onClose,
  onDone,
}: Shared & { messages: Message[]; saved?: boolean }) {
  // Messages in «Избранное» have no second copy, so they are simply deleted.
  const [everyone, setEveryone] = useState(saved);
  const mutation = useMutation(onDone, onClose);
  const messageWord = {
    one: 'сообщение',
    few: 'сообщения',
    many: 'сообщений',
    other: 'сообщений',
    zero: 'сообщений',
    two: 'сообщения',
  }[new Intl.PluralRules('ru').select(messages.length)];
  return (
    <Dialog {...mutation.dialogProps}>
      <DialogContent
        className="noct-dialog chat-operation-dialog chat-delete-dialog"
        overlayClassName="chat-delete-backdrop"
        showCloseButton={false}
      >
        <DialogTitle>
          {messages.length > 1
            ? `Удалить ${messages.length} ${messageWord}?`
            : 'Удалить сообщение?'}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Без галочки сообщения удалятся только у тебя.
        </DialogDescription>
        {!saved && (
          <label className="chat-delete-choice">
            <input
              type="checkbox"
              checked={everyone}
              disabled={mutation.frozen}
              onChange={(event) => setEveryone(event.target.checked)}
            />
            <span>
              Также удалить для <bdi>{peer.name}</bdi>
            </span>
          </label>
        )}
        {messages.some((message) => message.gift) && (
          <p className="chat-operation-note">
            Сам подарок останется в профиле получателя.
          </p>
        )}
        {mutation.error && (
          <p role="alert" className="chat-send-error">
            {mutation.error}
          </p>
        )}
        <div className="chat-operation-buttons">
          <button
            className="secondary"
            disabled={mutation.frozen}
            onClick={mutation.close}
          >
            Отмена
          </button>
          <button
            className="chat-delete-confirm"
            disabled={mutation.busy}
            onClick={() =>
              void mutation.submit({
                action: 'messageDelete',
                peer: peer.id,
                ids: messages.map((message) => message.id),
                everyone,
              })
            }
          >
            {mutation.busy && <LoaderCircle className="spin" size={17} />}
            {mutation.busy
              ? 'Удаляем…'
              : mutation.uncertain
                ? 'Повторить'
                : 'Удалить'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function ChatEditDialog({
  message,
  peer,
  onClose,
  onDone,
}: Shared & { message: Message }) {
  const [text, setText] = useState(message.text);
  const mutation = useMutation(onDone, onClose);
  return (
    <Dialog {...mutation.dialogProps}>
      <DialogContent
        className="noct-dialog chat-operation-dialog"
        showCloseButton={!mutation.frozen}
      >
        <DialogTitle>
          {message.attachments?.length
            ? 'Изменить подпись'
            : 'Изменить сообщение'}
        </DialogTitle>
        <DialogDescription>Изменения увидит и собеседник.</DialogDescription>
        <ChatTextEditor
          className="chat-edit-text"
          label="Текст сообщения"
          value={text}
          disabled={mutation.frozen}
          onChange={setText}
        />
        {mutation.error && (
          <p role="alert" className="chat-send-error">
            {mutation.error}
          </p>
        )}
        <div className="chat-operation-buttons">
          <button
            className="secondary"
            disabled={mutation.frozen}
            onClick={mutation.close}
          >
            Отмена
          </button>
          <button
            className="primary"
            disabled={
              mutation.busy || (!text.trim() && !message.attachments?.length)
            }
            onClick={() =>
              void mutation.submit({
                action: 'messageEdit',
                peer: peer.id,
                id: message.id,
                text,
                revision: message.editedAt || 0,
              })
            }
          >
            {mutation.busy && <LoaderCircle className="spin" size={17} />}
            {mutation.uncertain ? 'Повторить' : 'Сохранить'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export { ChatForwardDialog } from './forward-dialog';
