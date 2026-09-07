'use client';
/* Private media needs session cookies; videos here are decorative, muted avatars. */
/* eslint-disable next/no-img-element, jsx-a11y/media-has-caption, jsx-a11y/prefer-tag-over-role, react/react-compiler */
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import { Switch } from '@base-ui/react/switch';
import type { Appearance } from '@/lib/appearance';
import { themeFor } from '@/lib/appearance';
import { NoctLogo } from './stars-icon';

type Identity = Appearance & { name: string; avatar?: string };
const motionEvent = 'noct:avatar-motion';
let fallbackMotion = true;
function motionSnapshot() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    return false;
  try {
    return localStorage.getItem('noct-avatar-motion') !== 'off';
  } catch {
    return fallbackMotion;
  }
}
function subscribeMotion(callback: () => void) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change', callback);
  window.addEventListener('storage', callback);
  window.addEventListener(motionEvent, callback);
  return () => {
    media.removeEventListener('change', callback);
    window.removeEventListener('storage', callback);
    window.removeEventListener(motionEvent, callback);
  };
}
function useMotion() {
  return useSyncExternalStore(subscribeMotion, motionSnapshot, () => false);
}
export function AnimationPreference() {
  const enabled = useMotion(),
    id = useId();
  return (
    <label className="appearance-switch" htmlFor={id}>
      <span>
        <strong>Анимации аватаров и обводок</strong>
        <small>
          На этом устройстве. Учитывает настройки уменьшения движения.
        </small>
      </span>
      <Switch.Root
        id={id}
        className="privacy-switch"
        checked={enabled}
        onCheckedChange={(value) => {
          fallbackMotion = value;
          try {
            localStorage.setItem('noct-avatar-motion', value ? 'on' : 'off');
          } catch {
            /* Storage may be unavailable in private mode. */
          }
          window.dispatchEvent(new Event(motionEvent));
        }}
      >
        <Switch.Thumb className="privacy-switch-thumb" />
      </Switch.Root>
    </label>
  );
}
export function appearanceStyle(person: Appearance): CSSProperties {
  const theme = themeFor(person);
  return {
    '--profile-first': theme.colors[0],
    '--profile-second': theme.colors[1],
    '--profile-wash': theme.wash,
  } as CSSProperties;
}
export function PremiumBadge({ person }: { person: Appearance }) {
  return person.premium ? (
    <span
      className="noct-premium-badge"
      style={appearanceStyle(person)}
      role="img"
      aria-label="Noct Premium"
      title="Noct Premium"
    />
  ) : null;
}
export function DisplayName({ person }: { person: Identity }) {
  return (
    <span className="display-name" style={appearanceStyle(person)}>
      <span
        className={
          person.premium && person.nameGradient
            ? 'display-name-text gradient-name'
            : 'display-name-text'
        }
      >
        {person.name}
      </span>
      <PremiumBadge person={person} />
    </span>
  );
}
export function Avatar({
  person,
  size = 40,
}: {
  person: Identity;
  size?: number;
}) {
  const enabled = useMotion();
  const root = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false),
    [failed, setFailed] = useState('');
  const motion = !!person.premium && enabled && !!person.avatarMotion;
  useEffect(() => {
    if (!motion || !root.current) {
      setVisible(false);
      return;
    }
    let inView = false;
    const update = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      update();
    });
    observer.observe(root.current);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [motion]);
  const words = person.name.trim().split(/\s+/);
  const initials =
    words.length > 1
      ? words[0].slice(0, 1) + words[words.length - 1].slice(0, 1)
      : person.name.slice(0, 2);
  const playing = motion && visible && failed !== person.avatarMotion;
  return (
    <span
      ref={root}
      className="avatar"
      style={{ width: size, height: size, fontSize: size / 2.8 }}
      aria-hidden="true"
    >
      {playing && person.avatarMotionType?.startsWith('video/') ? (
        <video
          key={person.avatarMotion}
          src={person.avatarMotion}
          poster={person.avatar}
          muted
          loop
          autoPlay
          playsInline
          preload="metadata"
          onError={() => setFailed(person.avatarMotion!)}
        />
      ) : playing ? (
        <img
          src={person.avatarMotion}
          alt=""
          onError={() => setFailed(person.avatarMotion!)}
        />
      ) : person.avatar ? (
        <img src={person.avatar} alt="" />
      ) : person.name === 'Noctgram' ? (
        <NoctLogo size={size * 1.08} />
      ) : (
        initials.toUpperCase()
      )}
    </span>
  );
}
export function ProfileAvatar({
  person,
  size = 96,
}: {
  person: Identity;
  size?: number;
}) {
  const id = useId().replace(/:/g, '');
  const enabled = useMotion();
  const text = person.premium ? person.ringText?.trim() : '';
  return (
    <span
      className={
        'avatar profile-identity-avatar' + (text ? ' has-text-ring' : '')
      }
      style={{ ...appearanceStyle(person), width: size, height: size }}
    >
      <Avatar person={person} size={size} />
      {text && (
        <svg
          className="profile-text-ring"
          viewBox="0 0 144 144"
          aria-hidden="true"
          style={{ animationPlayState: enabled ? 'running' : 'paused' }}
        >
          <defs>
            <path
              id={id}
              d="M72,72 m-60,0 a60,60 0 1,1 120,0 a60,60 0 1,1 -120,0"
            />
            <linearGradient id={id + '-gradient'}>
              <stop offset="0%" stopColor="var(--profile-first)" />
              <stop offset="100%" stopColor="var(--profile-second)" />
            </linearGradient>
          </defs>
          <text
            fill={'url(#' + id + '-gradient)'}
            fontSize="11"
            letterSpacing="2"
          >
            <textPath href={'#' + id} textLength="374" lengthAdjust="spacing">
              {text + ' · '}
            </textPath>
          </text>
        </svg>
      )}
    </span>
  );
}
