'use client';
/* eslint-disable next/no-img-element */
import { memo, useState } from 'react';
import { appleEmojiUrl, chatEmojiParts } from '@/lib/chat-emoji';
import { MentionText } from './profile-link';
import { PremiumEmoji } from './premium-emoji';

function AppleEmoji({
  text,
  unified,
  large,
}: {
  text: string;
  unified: string;
  large: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={'chat-emoji' + (failed ? ' chat-emoji-fallback' : '')}>
      <span className="chat-emoji-character">{text}</span>
      {!failed && (
        <img
          src={appleEmojiUrl(unified, large)}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
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
