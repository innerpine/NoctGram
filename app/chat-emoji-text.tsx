'use client';
import { memo } from 'react';
import { chatEmojiParts } from '@/lib/chat-emoji';
import { MentionText } from './profile-link';
import { AppleEmoji, PremiumEmoji } from './premium-emoji';

export const ChatEmojiText = memo(function ChatEmojiText({
  text,
  large = false,
  mentions = true,
}: {
  text: string;
  large?: boolean;
  mentions?: boolean;
}) {
  return (
    <>
      {chatEmojiParts(text).map((part, index) =>
        part.premium ? (
          <PremiumEmoji
            key={index + ':' + part.premium.id}
            emoji={part.premium}
          />
        ) : part.unified ? (
          <AppleEmoji
            key={index + ':' + part.unified}
            text={part.text}
            unified={part.unified}
            large={large}
          />
        ) : mentions ? (
          <MentionText key={index} text={part.text} />
        ) : (
          part.text
        ),
      )}
    </>
  );
});
