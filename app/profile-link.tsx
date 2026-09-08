'use client';
import { useContext, type ComponentProps } from 'react';
import {
  PROFILE_NAVIGATE,
  profileHref,
  mentionParts,
  type ProfileTarget,
  type ProfileNavigation,
} from '@/lib/profile-links';
import { ProfileLinkDialogs } from '@/lib/profile-navigation-context';

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
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        const navigation = new CustomEvent<ProfileNavigation>(
          PROFILE_NAVIGATE,
          {
            detail: {
              ...target,
              onNavigated: () =>
                dialogs.toReversed().forEach((close) => close()),
            },
            cancelable: true,
          },
        );
        if (!window.dispatchEvent(navigation)) event.preventDefault();
        event.stopPropagation();
      }}
    >
      {children}
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
        ) : (
          part.text
        ),
      )}
    </>
  );
}
