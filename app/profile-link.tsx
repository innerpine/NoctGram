'use client';
import { EmojiText } from './premium-emoji';
import { useContext, type ComponentProps, type MouseEvent } from 'react';
import {
  PROFILE_NAVIGATE,
  profileHref,
  profileTargetFromURL,
  mentionParts,
  type ProfileTarget,
  type ProfileNavigation,
} from '@/lib/profile-links';
import { ProfileLinkDialogs } from '@/lib/profile-navigation-context';

function navigateLink(
  event: MouseEvent<HTMLAnchorElement>,
  target: ProfileTarget | null,
  dialogs: readonly (() => void)[],
) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const selection = event.currentTarget?.ownerDocument.getSelection();
  if (
    event.detail > 0 &&
    selection &&
    !selection.isCollapsed &&
    selection.containsNode(event.currentTarget, true)
  ) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  event.stopPropagation();
  if (!target) return;
  const navigation = new CustomEvent<ProfileNavigation>(PROFILE_NAVIGATE, {
    detail: {
      ...target,
      onNavigated: () => dialogs.toReversed().forEach((close) => close()),
    },
    cancelable: true,
  });
  if (!window.dispatchEvent(navigation)) event.preventDefault();
}

export function ProfileLink({
  target,
  className = '',
  children,
  ...props
}: Omit<ComponentProps<'a'>, 'href' | 'target'> & { target: ProfileTarget }) {
  const dialogs = useContext(ProfileLinkDialogs);
  return (
    <a
      {...props}
      href={profileHref(target)}
      className={'profile-link ' + className}
      onClick={(event) => {
        props.onClick?.(event);
        navigateLink(event, target, dialogs);
      }}
    >
      {children}
    </a>
  );
}

export function ContentLink({ href, text }: { href: string; text: string }) {
  const dialogs = useContext(ProfileLinkDialogs);
  return (
    <a
      href={href}
      className="profile-link profile-mention"
      rel="noreferrer noopener"
      onClick={(event) =>
        navigateLink(
          event,
          profileTargetFromURL(href, window.location.origin),
          dialogs,
        )
      }
    >
      {text}
    </a>
  );
}

export function MentionText({ text }: { text: string }) {
  return (
    <>
      {mentionParts(text).map((part, index) =>
        part.handle ? (
          <ProfileLink
            key={index}
            target={{ handle: part.handle }}
            className="profile-mention"
          >
            {part.text}
          </ProfileLink>
        ) : part.href ? (
          <ContentLink key={index} href={part.href} text={part.text} />
        ) : (
          <EmojiText key={index} text={part.text} />
        ),
      )}
    </>
  );
}
