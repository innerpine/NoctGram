'use client';
/* Private media needs session cookies; videos here are decorative, muted avatars. */
/* eslint-disable next/no-img-element, jsx-a11y/media-has-caption, jsx-a11y/prefer-tag-over-role, react/react-compiler */
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  memo,
  type CSSProperties,
} from 'react';
import { Switch } from '@base-ui/react/switch';
import type { Appearance } from '@/lib/appearance';
import { themeFor, chromeTempo, hasProfileDesign } from '@/lib/appearance';
import { NoctLogo } from './stars-icon';
import { GratitudeBadge } from './gratitude-badge';
import { avatarSource, avatarSources } from '@/lib/avatar-variants';
import { observeElementVisibility } from '@/lib/element-visibility';

type Identity = Appearance & { name: string; avatar?: string };
const motionEvent = 'noct:avatar-motion';
let fallbackMotion = true;
let cachedMotion: boolean | undefined;
const motionListeners = new Set<() => void>();
let motionMedia: MediaQueryList | undefined;
function readMotion() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    return false;
  try {
    return localStorage.getItem('noct-avatar-motion') !== 'off';
  } catch {
    return fallbackMotion;
  }
}
function motionSnapshot() {
  return (cachedMotion ??= readMotion());
}
function refreshMotion() {
  const next = readMotion();
  if (next === cachedMotion) return;
  cachedMotion = next;
  motionListeners.forEach((listener) => listener());
}
function subscribeMotion(callback: () => void) {
  const media = (motionMedia ??= window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ));
  if (!motionListeners.size) {
    media.addEventListener('change', refreshMotion);
    window.addEventListener('storage', refreshMotion);
    window.addEventListener(motionEvent, refreshMotion);
  }
  motionListeners.add(callback);
  refreshMotion();
  return () => {
    motionListeners.delete(callback);
    if (!motionListeners.size) {
      media.removeEventListener('change', refreshMotion);
      window.removeEventListener('storage', refreshMotion);
      window.removeEventListener(motionEvent, refreshMotion);
      cachedMotion = undefined;
      motionMedia = undefined;
    }
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
          hasProfileDesign(person) && person.nameGradient
            ? 'display-name-text gradient-name'
            : (person.boostLevel || 0) > 0
              ? 'display-name-text colored-channel-name'
              : 'display-name-text'
        }
      >
        {person.name}
      </span>
      {person.gratitude ? <GratitudeBadge person={person} /> : null}
      <PremiumBadge person={person} />
    </span>
  );
}
export function VerifiedBadge({ person }: { person: Appearance }) {
  return person.verified ? (
    <span
      className="noct-verified-badge"
      style={appearanceStyle(person)}
      role="img"
      aria-label="Подтверждённый аккаунт NoctGram"
      title="Подтверждённый аккаунт NoctGram"
    />
  ) : null;
}
export function VerifiedProfile({ person }: { person: Appearance }) {
  return person.verified ? (
    <div className="profile-verification" style={appearanceStyle(person)}>
      <VerifiedBadge person={person} />
      <span>
        Этот аккаунт подтверждён как официальный представителями NoctGram.
      </span>
    </div>
  ) : null;
}
export const Avatar = memo(
  function Avatar({
    person,
    size = 40,
    eager = false,
  }: {
    person: Identity;
    size?: number;
    eager?: boolean;
  }) {
    const enabled = useMotion();
    const root = useRef<HTMLSpanElement>(null);
    const video = useRef<HTMLVideoElement>(null);
    const [started, setStarted] = useState('');
    const [visible, setVisible] = useState(false),
      [failed, setFailed] = useState('');
    const motion = hasProfileDesign(person) && enabled && !!person.avatarMotion;
    const chrome = hasProfileDesign(person) && !!person.chromeFlow;
    const observe = enabled && (motion || chrome);
    useEffect(() => {
      if (!observe || !root.current) {
        setVisible(false);
        return;
      }
      return observeElementVisibility(root.current, setVisible);
    }, [observe]);
    const words = person.name.trim().split(/\s+/);
    const initials =
      words.length > 1
        ? words[0].slice(0, 1) + words[words.length - 1].slice(0, 1)
        : person.name.slice(0, 2);
    const playing = motion && visible && failed !== person.avatarMotion;
    const videoMotion = motion && person.avatarMotionType?.startsWith('video/');
    useEffect(() => {
      if (playing && videoMotion) setStarted(person.avatarMotion!);
    }, [playing, videoMotion, person.avatarMotion]);
    useEffect(() => {
      const element = video.current;
      if (!element) return;
      if (playing) void element.play().catch(() => {});
      else element.pause();
    }, [playing, started]);
    useEffect(() => {
      if (playing || !started) return;
      // Keep the decoder during a brief scroll reversal, then release offscreen
      // videos so a long feed cannot accumulate every previously seen decoder.
      const timer = window.setTimeout(() => setStarted(''), 10000);
      return () => window.clearTimeout(timer);
    }, [playing, started]);
    const content =
      playing && !videoMotion ? (
        <img
          src={person.avatarMotion}
          alt=""
          onError={() => setFailed(person.avatarMotion!)}
        />
      ) : person.avatar ? (
        <img
          src={avatarSource(person.avatar, size > 96 ? 384 : 96)}
          srcSet={avatarSources(person.avatar)}
          sizes={`${size}px`}
          width={size}
          height={size}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
        />
      ) : person.name === 'Noctgram' ? (
        <NoctLogo size={size * 1.08} />
      ) : (
        initials.toUpperCase()
      );
    const tempo = Math.min(
      chromeTempo.max,
      Math.max(chromeTempo.min, person.chromeTempo || chromeTempo.default),
    );
    const face = (
      <>
        {content}
        {videoMotion && started === person.avatarMotion && (
          <video
            ref={video}
            className="avatar-motion-layer"
            key={person.avatarMotion}
            src={person.avatarMotion}
            muted
            loop
            playsInline
            preload="metadata"
            style={{ visibility: playing ? 'visible' : 'hidden' }}
            onError={() => setFailed(person.avatarMotion!)}
          />
        )}
      </>
    );
    return (
      <span
        ref={root}
        className={'avatar' + (chrome ? ' chrome-avatar' : '')}
        style={
          {
            ...appearanceStyle(person),
            width: size,
            height: size,
            fontSize: size / 2.8,
            '--chrome-tempo': `${tempo}s`,
          } as CSSProperties
        }
        aria-hidden="true"
      >
        {chrome ? (
          <>
            <span className="avatar-face">{face}</span>
            <span
              className="chrome-flow-frame"
              style={{
                animationPlayState: enabled && visible ? 'running' : 'paused',
              }}
            />
          </>
        ) : (
          face
        )}
      </span>
    );
  },
  (a, b) =>
    a.size === b.size &&
    a.eager === b.eager &&
    (
      [
        'name',
        'avatar',
        'premium',
        'boostLevel',
        'profileTheme',
        'chromeFlow',
        'chromeTempo',
        'avatarMotion',
        'avatarMotionType',
      ] as const
    ).every((key) => a.person[key] === b.person[key]),
);
export function ProfileAvatar({
  person,
  size = 96,
}: {
  person: Identity;
  size?: number;
}) {
  const id = useId().replace(/:/g, '');
  const enabled = useMotion();
  const text = hasProfileDesign(person) ? person.ringText?.trim() : '';
  const ringRoot = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!enabled || !text || !ringRoot.current) return;
    return observeElementVisibility(ringRoot.current, setVisible);
  }, [enabled, text]);
  return (
    <span
      ref={ringRoot}
      className={
        'avatar profile-identity-avatar' +
        (text ? ' has-text-ring' : '') +
        (hasProfileDesign(person) && person.chromeFlow
          ? ' has-chrome-flow'
          : '')
      }
      style={{ ...appearanceStyle(person), width: size, height: size }}
    >
      <Avatar person={person} size={size} />
      {text && (
        <svg
          className="profile-text-ring"
          viewBox="0 0 144 144"
          aria-hidden="true"
          style={{
            animationPlayState: enabled && visible ? 'running' : 'paused',
          }}
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
