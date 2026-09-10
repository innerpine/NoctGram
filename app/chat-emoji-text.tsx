'use client';
/* eslint-disable next/no-img-element */
import { memo, useState } from 'react';
import { appleEmojiUrl, chatEmojiParts } from '@/lib/chat-emoji';
import { MentionText } from './profile-link';

function AppleEmoji({ text, unified }: { text: string; unified: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={'chat-emoji' + (failed ? ' chat-emoji-fallback' : '')}>
      <span className="chat-emoji-character">{text}</span>
      {!failed && (
        <img
          src={appleEmojiUrl(unified)}
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
}: {
  text: string;
}) {
  return (
    <>
      {chatEmojiParts(text).map((part, index) =>
        part.unified ? (
          <AppleEmoji key={index} text={part.text} unified={part.unified} />
        ) : (
          <MentionText key={index} text={part.text} />
        ),
      )}
    </>
  );
});
