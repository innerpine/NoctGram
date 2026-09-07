'use client';
import { useRef, useState } from 'react';
import { request } from '@/lib/client';
export function ContentDecisionForm({
  id,
  type,
  action,
  text,
  onDone,
  onCancel,
}: {
  id: string;
  type: 'post' | 'comment' | 'message';
  action: 'remove' | 'report';
  text: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  const remove = action === 'remove';
  return (
    <form
      className="edit-form moderation-decision"
      onSubmit={async (e) => {
        e.preventDefault();
        if (lock.current || !reason.trim()) return;
        lock.current = true;
        setBusy(true);
        setError('');
        try {
          await request('', {
            action: remove
              ? 'removeContent'
              : type === 'post'
                ? 'report'
                : type === 'message'
                  ? 'reportMessage'
                  : 'reportComment',
            id,
            targetType: type,
            reason,
          });
          onDone();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      <strong>
        {remove
          ? 'Удаление модератором'
          : type === 'message'
            ? 'Жалоба на сообщение'
            : 'Жалоба на комментарий'}
      </strong>
      <blockquote>{text || 'Публикация с медиа'}</blockquote>
      {remove && (
        <p className="account-note">
          {type === 'post'
            ? 'Пост, его комментарии и вложения станут недоступны.'
            : 'Комментарий будет удалён из обсуждения.'}{' '}
          Решение и причина сохранятся в истории. Восстановление не
          предусмотрено.
        </p>
      )}
      <label>
        {remove ? 'Причина удаления' : 'Что нарушает правила?'}
        <textarea
          required
          maxLength={500}
          rows={3}
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Опиши нарушение"
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="account-actions">
        <button
          className={remove ? 'danger moderation-submit' : 'primary'}
          disabled={busy || !reason.trim()}
        >
          {busy
            ? 'Сохраняем…'
            : remove
              ? 'Подтвердить удаление'
              : 'Отправить жалобу'}
        </button>
        <button
          className="secondary"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Отмена
        </button>
      </div>
    </form>
  );
}
