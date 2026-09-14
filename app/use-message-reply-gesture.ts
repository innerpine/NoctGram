'use client';
import { useLayoutEffect, useState } from 'react';
import { createMessageReplyGesture } from '@/lib/message-reply-gesture';

export function useMessageReplyGesture(enabled: boolean, reply: () => void) {
  const [controller] = useState(() =>
    createMessageReplyGesture({
      enabled: () => enabled,
      reply,
    }),
  );
  useLayoutEffect(() => {
    controller.configure({ enabled: () => enabled, reply });
  }, [enabled, reply, controller]);
  useLayoutEffect(() => () => controller.cancel(), [controller]);
  return controller;
}
