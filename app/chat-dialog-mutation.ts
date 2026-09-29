'use client';
/* eslint-disable react/react-compiler */
import { useEffect, useRef, useState } from 'react';
import { chatRequest } from '@/lib/chat-client';

// One confirmed operation per dialog. An unanswered request keeps the dialog
// open and retries the same body, so the server can deduplicate it.
export function useDialogMutation<T = unknown>(
  onDone: (result: T) => void,
  onClose: () => void,
) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState('');
  const attempt = useRef<Record<string, unknown> | null>(null),
    locked = useRef(false),
    completed = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const submit = async (body: Record<string, unknown>, url = '/api/social') => {
    if (locked.current || !open) return;
    locked.current = true;
    setBusy(true);
    setError('');
    attempt.current ??= body;
    try {
      const result = await chatRequest<T>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attempt.current),
        signal: AbortSignal.timeout(30000),
      });
      if (alive.current) {
        completed.current = true;
        setOpen(false);
        onDone(result);
      }
    } catch (error) {
      if (!alive.current) return;
      const status = (error as { status?: number }).status;
      const unknown = !status || status >= 500;
      setUncertain(unknown);
      if (!unknown) attempt.current = null;
      setError(
        unknown
          ? 'Ответ не получен. Повтори действие — оно не продублируется.'
          : error instanceof Error
            ? error.message
            : 'Не удалось выполнить действие',
      );
    } finally {
      locked.current = completed.current;
      if (alive.current) setBusy(completed.current);
    }
  };
  const close = () => {
    if (!locked.current && !uncertain) {
      locked.current = true;
      setOpen(false);
    }
  };
  return {
    busy: busy || !open,
    frozen: busy || uncertain || !open,
    uncertain,
    error,
    submit,
    close,
    dialogProps: {
      open,
      onOpenChange: (next: boolean) => {
        if (!next) close();
      },
      onOpenChangeComplete: (next: boolean) => {
        if (!next) onClose();
      },
    },
  };
}
