'use client';
/* eslint-disable next/no-img-element */
import { useEffect, useId, useSyncExternalStore } from 'react';
import { Switch } from '@base-ui/react/switch';
import {
  cursorServerSnapshot,
  cursorSnapshot,
  setCursorPreference,
  subscribeCursor,
  syncCursorPreference,
} from '@/lib/cursor-preference';

export function CursorPreferenceSync() {
  useEffect(syncCursorPreference, []);
  return null;
}
export function CursorPreference() {
  const id = useId();
  const enabled = useSyncExternalStore(
    subscribeCursor,
    cursorSnapshot,
    cursorServerSnapshot,
  );
  return (
    <label className="appearance-switch cursor-preference" htmlFor={id}>
      <span className="cursor-preference-art" aria-hidden="true">
        <img
          src="/assets/cursors/noct-arrow.svg"
          alt=""
          width={32}
          height={32}
        />
      </span>
      <span>
        <strong>Курсор Noctgram</strong>
        <small>Фирменный курсор мыши. Выбор сохраняется в этом браузере.</small>
      </span>
      <Switch.Root
        id={id}
        className="privacy-switch"
        checked={enabled}
        onCheckedChange={setCursorPreference}
      >
        <Switch.Thumb className="privacy-switch-thumb" />
      </Switch.Root>
    </label>
  );
}
