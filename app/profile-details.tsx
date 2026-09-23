'use client';
import { useEffect, useId, useState } from 'react';
import { Switch } from '@base-ui/react/switch';
import { Cake, CalendarDays, Link2, MapPin } from 'lucide-react';
import { Avatar, DisplayName } from './profile-identity';
import { Stamp } from './post-card';
import { ProfileLink } from './profile-link';
import { EmojiText } from './premium-emoji';
import { InstagramIcon, TikTokIcon, YouTubeIcon } from './social-icons';
import {
  request,
  type Person,
  type Profile,
  type ProfileChannelCard,
} from '@/lib/client';

const socials = [
  {
    key: 'instagram',
    label: 'Instagram',
    Icon: InstagramIcon,
    placeholder: '@username',
    url: (name: string) => `https://www.instagram.com/${name}/`,
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    Icon: TikTokIcon,
    placeholder: '@username',
    url: (name: string) => `https://www.tiktok.com/@${name}`,
  },
  {
    key: 'youtube',
    label: 'YouTube',
    Icon: YouTubeIcon,
    placeholder: '@handle',
    url: (name: string) => `https://www.youtube.com/@${name}`,
  },
] as const;
const external = 'noopener noreferrer nofollow ugc';
const pluralRules = new Intl.PluralRules('ru');
function plural(value: number, one: string, few: string, many: string) {
  const form = pluralRules.select(value);
  return form === 'one' ? one : form === 'few' ? few : many;
}
function birthdayLabel(value: string) {
  const date = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(value);
  if (!date) return '';
  const [year, month, day] = date.slice(1).map(Number);
  const label = new Date(Date.UTC(2000, month - 1, day)).toLocaleDateString(
    'ru-RU',
    { day: 'numeric', month: 'long', timeZone: 'UTC' },
  );
  if (!year) return label;
  const now = new Date(),
    age = Math.max(
      0,
      now.getFullYear() -
        year -
        (now.getMonth() + 1 < month ||
        (now.getMonth() + 1 === month && now.getDate() < day)
          ? 1
          : 0),
    );
  return `${label} ${year} (${age} ${plural(age, 'год', 'года', 'лет')})`;
}

/** Twitter-style meta row plus social buttons; channels show only the join date. */
export function ProfileMeta({ profile }: { profile: Profile }) {
  const person = profile.kind !== 'channel',
    site =
      person && /^https?:\/\//i.test(profile.website || '')
        ? profile.website!
        : '',
    siteLabel = site.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''),
    birthday = person ? birthdayLabel(profile.birthday || '') : '',
    links = person ? socials.filter(({ key }) => profile[key]) : [];
  return (
    <>
      <div className="profile-details">
        {person && profile.location && (
          <span className="profile-detail">
            <MapPin size={14} aria-hidden="true" />
            {profile.location}
          </span>
        )}
        {site && (
          <span className="profile-detail">
            <Link2 size={14} aria-hidden="true" />
            <a
              className="profile-detail-link"
              href={site}
              target="_blank"
              rel={external}
              title={site}
            >
              {siteLabel.length > 32 ? siteLabel.slice(0, 31) + '…' : siteLabel}
            </a>
          </span>
        )}
        {birthday && (
          <span className="profile-detail" title="День рождения">
            <Cake size={14} aria-hidden="true" />
            {birthday}
          </span>
        )}
        <span className="profile-detail">
          <CalendarDays size={14} aria-hidden="true" /> В Noctgram с{' '}
          {new Date(profile.created).toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </span>
      </div>
      {!!links.length && (
        <div className="profile-socials">
          {links.map(({ key, label, Icon, url }) => {
            const name = profile[key]!;
            return (
              <a
                key={key}
                className="profile-social"
                href={url(encodeURIComponent(name))}
                target="_blank"
                rel={external}
                aria-label={`${label}: @${name}`}
                title={`${label}: @${name}`}
              >
                <Icon size={18} />
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}

function preview(post: ProfileChannelCard['post']) {
  if (!post) return 'Пока нет публикаций';
  if (post.text) return <EmojiText text={post.text} />;
  return post.media === 'photo'
    ? 'Фото'
    : post.media === 'video'
      ? 'Видео'
      : post.media === 'file'
        ? 'Файл'
        : post.poll
          ? 'Опрос'
          : post.code
            ? 'Код'
            : 'Публикация';
}

/** Telegram-style "personal channel" cards under the profile stats. */
export function ProfileChannels({
  channels,
}: {
  channels?: ProfileChannelCard[];
}) {
  if (!channels?.length) return null;
  return (
    <div className="profile-channels">
      {channels.map((channel) => (
        <ProfileLink
          key={channel.id}
          target={{ id: channel.id }}
          className="profile-channel-card"
        >
          <span className="profile-channel-top">
            <span>Канал</span>
            <span>
              {channel.followers.toLocaleString('ru-RU')}{' '}
              {plural(
                channel.followers,
                'подписчик',
                'подписчика',
                'подписчиков',
              )}
            </span>
          </span>
          <span className="profile-channel-body">
            <Avatar person={channel} size={44} />
            <span className="profile-channel-copy">
              <DisplayName person={channel} />
              <span className="profile-channel-preview">
                {preview(channel.post)}
              </span>
            </span>
            {channel.post && <Stamp time={channel.post.created} compact />}
          </span>
        </ProfileLink>
      ))}
    </div>
  );
}

export type ProfileDetailsDraft = {
  location: string;
  website: string;
  instagram: string;
  tiktok: string;
  youtube: string;
  birthday: string;
  showBirthYear: boolean;
  personalChannels: string[];
};
/** Field names match POST /api/social {action:'profile'}, so the draft is sent as is. */
export function detailsDraft(profile: Profile): ProfileDetailsDraft {
  return {
    location: profile.location || '',
    website: profile.website || '',
    instagram: profile.instagram || '',
    tiktok: profile.tiktok || '',
    youtube: profile.youtube || '',
    birthday: profile.birthday || '',
    showBirthYear: profile.showBirthYear ?? true,
    personalChannels: profile.personalChannels?.map(({ id }) => id) || [],
  };
}

export function ProfileDetailsFields({
  value,
  onChange,
  disabled,
}: {
  value: ProfileDetailsDraft;
  onChange: (value: ProfileDetailsDraft) => void;
  disabled: boolean;
}) {
  const [channels, setChannels] = useState<Person[] | null>(null),
    [failed, setFailed] = useState(false),
    // sv-SE formats the local date as YYYY-MM-DD.
    [today] = useState(() => new Date().toLocaleDateString('sv-SE')),
    switchId = useId(),
    picked = value.personalChannels;
  useEffect(() => {
    let live = true;
    request<{ channels: Person[] }>('?action=myChannels')
      .then((data) => live && setChannels(data.channels))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);
  return (
    <>
      <fieldset className="edit-usernames profile-details-section">
        <h3>Подробнее</h3>
        <label>
          Местоположение
          <input
            value={value.location}
            maxLength={30}
            placeholder="Город, страна"
            onChange={(e) => onChange({ ...value, location: e.target.value })}
          />
        </label>
        <label>
          Сайт
          <input
            type="text"
            inputMode="url"
            autoComplete="url"
            maxLength={100}
            value={value.website}
            placeholder="example.com"
            onChange={(e) => onChange({ ...value, website: e.target.value })}
          />
        </label>
        <label>
          Дата рождения
          <input
            type="date"
            min="1900-01-01"
            max={today}
            value={value.birthday}
            onChange={(e) => onChange({ ...value, birthday: e.target.value })}
          />
        </label>
        <label
          className="appearance-switch profile-details-switch"
          htmlFor={switchId}
        >
          <span>
            <strong>Показывать год рождения</strong>
            <small>Иначе в профиле будут только день и месяц.</small>
          </span>
          <Switch.Root
            id={switchId}
            className="privacy-switch"
            checked={value.showBirthYear}
            disabled={disabled}
            onCheckedChange={(showBirthYear) =>
              onChange({ ...value, showBirthYear })
            }
          >
            <Switch.Thumb className="privacy-switch-thumb" />
          </Switch.Root>
        </label>
      </fieldset>
      <fieldset className="edit-usernames profile-details-section">
        <h3>Соцсети</h3>
        {socials.map(({ key, label, Icon, placeholder }) => (
          <label key={key}>
            <span className="profile-details-label">
              <Icon size={15} />
              {label}
            </span>
            <input
              value={value[key]}
              maxLength={200}
              placeholder={placeholder}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            />
          </label>
        ))}
        <p className="meta">
          Можно вставить и ссылку на профиль — сохраним только имя.
        </p>
      </fieldset>
      <fieldset className="edit-usernames profile-details-section">
        <h3>Каналы в профиле</h3>
        <p className="meta">
          Как в Telegram: до трёх своих каналов появятся в профиле под
          описанием.
        </p>
        {channels?.map((channel) => {
          const order = picked.indexOf(channel.id);
          return (
            <button
              key={channel.id}
              type="button"
              className="profile-channel-option"
              aria-pressed={order >= 0}
              disabled={order < 0 && picked.length >= 3}
              onClick={() =>
                onChange({
                  ...value,
                  personalChannels:
                    order >= 0
                      ? picked.filter((id) => id !== channel.id)
                      : [...picked, channel.id],
                })
              }
            >
              <Avatar person={channel} size={36} />
              <span className="profile-channel-option-copy">
                <strong>{channel.name}</strong>
                <small>@{channel.handle}</small>
              </span>
              {order >= 0 && (
                <span className="profile-channel-order">{order + 1}</span>
              )}
            </button>
          );
        })}
        {channels && !channels.length && (
          <p className="meta">У тебя пока нет своих каналов</p>
        )}
        {failed && <p className="meta">Не удалось загрузить каналы</p>}
      </fieldset>
    </>
  );
}
