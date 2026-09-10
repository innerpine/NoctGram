'use client';
import { useState } from 'react';
import { ChatEmojiText } from './chat-emoji-text';
import { ChatReveal } from './chat-reveal';
import { ChevronDown, Pin, PinOff } from 'lucide-react';
import type { Message } from '@/lib/client';
import { messageSummary, sortedPins } from '@/lib/chat-message-display';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

export function ChatPins({
  messages,
  disabled,
  onPin,
  onJump,
}: {
  messages: Message[];
  disabled: boolean;
  onPin: (message: Message) => void;
  onJump: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState('');
  const pins = sortedPins(messages);
  if (open && !pins.length) setOpen(false);
  return (
    <>
      <ChatReveal>
        {pins.length > 0 && (
          <div className="chat-pinned-bar">
            <Pin size={18} aria-hidden="true" />
            <button
              type="button"
              className="chat-pinned-summary"
              onClick={() => onJump(pins[0].id)}
            >
              <strong>
                Закреплено{pins.length > 1 ? ` · ${pins.length}` : ''}
              </strong>
              <span key={pins[0].id}>
                <ChatEmojiText
                  text={messageSummary(pins[0])}
                  mentions={false}
                />
              </span>
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Все закреплённые сообщения"
              title="Все закреплённые сообщения"
              onClick={() => setOpen(true)}
            >
              <ChevronDown size={17} />
            </button>
          </div>
        )}
      </ChatReveal>
      <Dialog
        open={open && pins.length > 0}
        onOpenChange={setOpen}
        onOpenChangeComplete={(isOpen) => {
          if (!isOpen && destination) {
            setDestination('');
            onJump(destination);
          }
        }}
      >
        <DialogContent
          className="noct-dialog chat-pins-dialog"
          finalFocus={destination ? false : undefined}
        >
          <DialogTitle>Важное в вашем диалоге</DialogTitle>
          <DialogDescription>
            Закреплённые сообщения видны вам обоим.
          </DialogDescription>
          <div className="chat-pinned-list">
            {pins.map((message) => (
              <div key={message.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setDestination(message.id);
                  }}
                >
                  <Pin size={15} />
                  <span>
                    <ChatEmojiText
                      text={messageSummary(message)}
                      mentions={false}
                    />
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-button"
                  disabled={disabled}
                  aria-label="Открепить сообщение"
                  onClick={() => onPin(message)}
                >
                  <PinOff size={16} />
                </button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
