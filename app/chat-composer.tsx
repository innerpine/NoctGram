'use client';
import { EmojiPicker } from './premium-emoji';
/* File transfers are scoped to this mounted conversation. */
/* eslint-disable react/react-compiler, next/no-img-element */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  File as FileIcon,
  LoaderCircle,
  Paperclip,
  RotateCcw,
  Send,
  Video,
  X,
  Reply,
} from 'lucide-react';
import {
  CHAT_ATTACHMENT_LIMIT,
  CHAT_FILE_LIMIT,
  chatFileKind,
  chatFileSize,
  type ChatAttachment,
} from '@/lib/chat-files';
import { chatRequest, discardChatFile } from '@/lib/chat-client';
import { ChatReveal } from './chat-reveal';
import { ChatTextEditor, type ChatTextEditorHandle } from './chat-text-editor';
import { ChatEmojiText } from './chat-emoji-text';
import type { ChatDraft } from '@/lib/chat-outbox';

type DraftFile = {
  id: string;
  file: File;
  preview: string;
  attachment?: ChatAttachment;
  error?: string;
};
export function ChatComposer({
  premium = false,
  peerId,
  text,
  onText,
  disabled,
  onSend,
  reply,
  replyFocus,
  onCancelReply,
}: {
  premium?: boolean;
  peerId: string;
  text: string;
  onText: (text: string) => void;
  disabled: boolean;
  onSend: (draft: ChatDraft) => void;
  reply?: NonNullable<ChatDraft['reply']> | null;
  replyFocus?: number;
  onCancelReply?: () => void;
}) {
  const [files, setFiles] = useState<DraftFile[]>([]);
  const current = useRef(files);
  const input = useRef<HTMLInputElement>(null);
  const editor = useRef<ChatTextEditorHandle>(null);
  const alive = useRef(true);
  const controllers = useRef(new Map<string, AbortController>());
  const locked = useRef(false);
  const [error, setError] = useState('');
  const changeFiles = (next: DraftFile[]) => {
    current.current = next;
    setFiles(next);
  };
  useEffect(() => {
    alive.current = true;
    const transfers = controllers.current;
    return () => {
      alive.current = false;
      for (const controller of transfers.values()) controller.abort();
      for (const item of current.current) {
        if (item.preview) URL.revokeObjectURL(item.preview);
        if (item.attachment) void discardChatFile(item.attachment.id);
      }
    };
  }, []);
  const uploadFile = async (item: DraftFile) => {
    const controller = new AbortController();
    controllers.current.set(item.id, controller);
    const timeout = setTimeout(() => controller.abort(), 120000);
    changeFiles(
      current.current.map((file) =>
        file.id === item.id ? { ...file, error: undefined } : file,
      ),
    );
    try {
      const form = new FormData();
      form.set('file', item.file);
      form.set('peer', peerId);
      const attachment = await chatRequest<ChatAttachment>('/api/chat-upload', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      if (
        !alive.current ||
        !current.current.some((file) => file.id === item.id)
      ) {
        void discardChatFile(attachment.id);
        return;
      }
      changeFiles(
        current.current.map((file) =>
          file.id === item.id ? { ...file, attachment } : file,
        ),
      );
    } catch (e) {
      if (alive.current)
        changeFiles(
          current.current.map((file) =>
            file.id === item.id
              ? {
                  ...file,
                  error:
                    e instanceof Error ? e.message : 'Не удалось загрузить',
                }
              : file,
          ),
        );
    } finally {
      clearTimeout(timeout);
      controllers.current.delete(item.id);
    }
  };
  const add = async (incoming: File[]) => {
    if (disabled || locked.current || !incoming.length) return;
    if (incoming.length + current.current.length > CHAT_ATTACHMENT_LIMIT) {
      setError('Можно прикрепить до 10 файлов');
      return;
    }
    if (incoming.some((file) => !file.size || file.size > CHAT_FILE_LIMIT)) {
      setError('Выбери непустые файлы до 25 МБ каждый');
      return;
    }
    setError('');
    const added = incoming.map((file) => ({
      id: crypto.randomUUID(),
      file,
      preview:
        chatFileKind(file.type) === 'image' ? URL.createObjectURL(file) : '',
    }));
    changeFiles([...current.current, ...added]);
    for (const item of added) {
      if (!alive.current) break;
      if (current.current.some((file) => file.id === item.id))
        await uploadFile(item);
    }
  };
  const remove = (item: DraftFile) => {
    controllers.current.get(item.id)?.abort();
    if (item.preview) URL.revokeObjectURL(item.preview);
    if (item.attachment) void discardChatFile(item.attachment.id);
    changeFiles(current.current.filter((file) => file.id !== item.id));
  };
  const submit = () => {
    if (
      disabled ||
      locked.current ||
      current.current.some((file) => !file.attachment) ||
      (!text.trim() && !current.current.length)
    )
      return;
    locked.current = true;
    setError('');
    onSend({
      text: text.trim(),
      attachments: current.current.map((file) => file.attachment!),
      reply: reply ?? undefined,
    });
    // Ownership passes to the outbox before unmount cleanup can discard files.
    for (const file of current.current)
      if (file.preview) URL.revokeObjectURL(file.preview);
    changeFiles([]);
    onText('');
    onCancelReply?.();
    editor.current?.focus();
  };
  // Keep rapid duplicate submits locked until React commits the cleared draft.
  useLayoutEffect(() => {
    locked.current = false;
  }, [text, files]);
  const frozen = disabled;
  const chooseEmoji = (emoji: string) => {
    if (frozen) return;
    setError('');
    editor.current?.insertEmoji(emoji);
  };
  useEffect(() => {
    if (reply?.id) editor.current?.focus();
  }, [reply?.id, replyFocus]);
  return (
    <div
      className="chat-compose-area"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          void add(Array.from(e.dataTransfer.files));
        }
      }}
    >
      <ChatReveal>
        {reply && (
          <div className="chat-reply-draft">
            <Reply size={19} />
            <span key={reply.id}>
              <strong>Ответ · {reply.name}</strong>
              <small>
                <ChatEmojiText text={reply.text} mentions={false} />
              </small>
            </span>
            <button
              type="button"
              disabled={frozen}
              aria-label="Отменить ответ"
              onClick={onCancelReply}
            >
              <X size={17} />
            </button>
          </div>
        )}
      </ChatReveal>
      {files.length > 0 && (
        <div className="chat-draft-files" aria-label="Вложения к сообщению">
          {files.map((item) => (
            <div
              key={item.id}
              className={'chat-draft-file' + (item.error ? ' failed' : '')}
            >
              {item.preview ? (
                <img src={item.preview} alt="" />
              ) : chatFileKind(item.file.type) === 'video' ? (
                <Video size={24} />
              ) : (
                <FileIcon size={24} />
              )}
              <span>
                <strong>{item.file.name}</strong>
                <small>
                  {item.error
                    ? item.error
                    : item.attachment
                      ? chatFileSize(item.file.size)
                      : 'Загружаем…'}
                </small>
              </span>
              {!item.attachment && !item.error && (
                <LoaderCircle className="spin" size={15} />
              )}
              {item.error && (
                <button
                  type="button"
                  disabled={frozen}
                  aria-label={'Повторить загрузку ' + item.file.name}
                  onClick={() => void uploadFile(item)}
                >
                  <RotateCcw size={15} />
                </button>
              )}
              <button
                type="button"
                disabled={frozen}
                aria-label={'Убрать ' + item.file.name}
                onClick={() => remove(item)}
              >
                <X size={15} />
              </button>
            </div>
          ))}
          <small className="chat-files-limit">
            {files.length} / 10 · до 25 МБ каждый
          </small>
        </div>
      )}
      {error && (
        <p className="chat-send-error" role="alert">
          {error}
        </p>
      )}
      <form
        className="message-composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void add(Array.from(e.target.files || []));
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="chat-attach-button"
          disabled={frozen}
          title="Фото, видео или файл"
          aria-label="Прикрепить фото, видео или файл"
          onClick={() => input.current?.click()}
        >
          <Paperclip size={21} />
        </button>
        <div className="chat-editor-container">
          <ChatTextEditor
            ref={editor}
            value={text}
            onChange={onText}
            disabled={frozen}
            placeholder={
              files.length ? 'Добавить подпись…' : 'Написать сообщение…'
            }
            onFiles={(files) => void add(files)}
            onSubmit={submit}
            onLimit={(reason) =>
              setError(
                reason === 'premium'
                  ? 'Можно добавить до 30 Premium-эмодзи'
                  : 'В сообщении может быть до 4000 символов',
              )
            }
          />
        </div>
        <EmojiPicker
          key={peerId}
          premium={premium}
          text={text}
          onText={onText}
          className="chat-emoji-button"
          align="end"
          onPrepareOpen={() => editor.current?.rememberSelection()}
          onInsert={chooseEmoji}
          onRestoreFocus={() => editor.current?.focus()}
          disabled={frozen}
        />
        <button
          type="submit"
          className="send-button"
          aria-label="Отправить сообщение"
          disabled={
            disabled ||
            files.some((file) => !file.attachment) ||
            (!text.trim() && !files.length)
          }
        >
          <Send size={21} fill="currentColor" strokeWidth={1.5} />
        </button>
      </form>
    </div>
  );
}
