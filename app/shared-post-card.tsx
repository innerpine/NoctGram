'use client';
/* Authenticated user media remains a normal browser request. */
/* eslint-disable next/no-img-element */
import { useSyncExternalStore } from 'react';
import { Video } from 'lucide-react';
import { readPostPreview, subscribePostPreview } from '@/lib/post-previews';
import { Avatar } from './profile-identity';
import { ChatEmojiText } from './chat-emoji-text';

export function openSharedPost(id: string) {
  window.dispatchEvent(
    new CustomEvent('noctgram:open-post', { detail: { id } }),
  );
}
// A feed post shared into a chat. Each viewer sees it under their own feed
// rules, so a post hidden from them reads «Публикация недоступна».
export function SharedPostCard({
  id,
  viewerId,
}: {
  id: string;
  viewerId: string;
}) {
  const entry = useSyncExternalStore(
    (listener) => subscribePostPreview(viewerId, id, listener),
    () => readPostPreview(viewerId, id),
    () => undefined,
  );
  if (!entry)
    return (
      <div className="shared-post loading" aria-busy="true">
        Загружаем публикацию…
      </div>
    );
  const post = entry.value;
  if (!post)
    return <div className="shared-post unavailable">Публикация недоступна</div>;
  const media = post.media;
  return (
    <button
      type="button"
      className="shared-post"
      aria-label={'Открыть публикацию: ' + post.name}
      onClick={() => openSharedPost(post.id)}
    >
      <span className="shared-post-author">
        <Avatar person={post} size={22} />
        <strong>{post.name}</strong>
      </span>
      {media && (
        <span className={'shared-post-media' + (post.adult ? ' adult' : '')}>
          {media.type.startsWith('image/') ? (
            <img
              src={'/api/media/' + encodeURIComponent(media.id)}
              alt=""
              loading="lazy"
            />
          ) : (
            <Video size={28} aria-hidden="true" />
          )}
          {post.adult ? <span className="adult-mark">18+</span> : null}
          {post.mediaCount > 1 && <b>+{post.mediaCount - 1}</b>}
        </span>
      )}
      {post.text ? (
        <span className="shared-post-text">
          <ChatEmojiText text={post.text} mentions={false} />
        </span>
      ) : (
        !media && (
          <span className="shared-post-text muted">
            {post.poll ? 'Опрос' : post.code ? 'Фрагмент кода' : 'Публикация'}
          </span>
        )
      )}
      <span className="shared-post-open">Открыть публикацию</span>
    </button>
  );
}
