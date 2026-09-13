'use client';
/* Account and giveaway changes invalidate the prior asynchronous snapshot. */
/* eslint-disable react/react-compiler */
import { useEffect, useState } from 'react';
import { Check, Clock3, Gift, LoaderCircle, Trophy, Users } from 'lucide-react';
import { giveawayRequest } from '@/lib/giveaways-client';
import type { Giveaway } from '@/lib/giveaways-types';
import { StarsIcon } from './stars-icon';
import { PremiumIcon } from './premium-icon';
import { ProfileLink } from './profile-link';
import { Avatar } from './profile-identity';

const number = (value: number) => value.toLocaleString('ru-RU');
const date = (value: number) =>
  new Date(value).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
export function remainingTime(endsAt: number, now: number) {
  const minutes = Math.max(0, Math.ceil((endsAt - now) / 60000));
  if (!minutes) return 'Подводим итоги';
  const days = Math.floor(minutes / 1440),
    hours = Math.floor((minutes % 1440) / 60);
  return days
    ? `${days} д ${hours} ч`
    : hours
      ? `${hours} ч ${minutes % 60} мин`
      : `${minutes} мин`;
}
export function GiveawayCard({
  id,
  viewerId,
}: {
  id: string;
  viewerId?: string;
}) {
  const [data, setData] = useState<Giveaway | null>(null);
  const [error, setError] = useState(''),
    [revision, retry] = useState(0);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let live = true,
      inFlight = false,
      finished = false;
    const controller = new AbortController();
    setData(null);
    setError('');
    if (!viewerId) return () => controller.abort();
    const load = async () => {
      if (inFlight || finished || document.hidden) return;
      inFlight = true;
      try {
        const result = await giveawayRequest<{ giveaway: Giveaway }>(
          '?id=' + encodeURIComponent(id),
          undefined,
          controller.signal,
        );
        if (!live) return;
        setData(result.giveaway);
        setError('');
        finished = result.giveaway.status === 'completed';
      } catch (cause) {
        if (live)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Не удалось загрузить розыгрыш',
          );
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = setInterval(() => {
      setNow(Date.now());
      void load();
    }, 15000);
    const focus = () => {
      setNow(Date.now());
      void load();
    };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      live = false;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [id, viewerId, revision]);
  if (!data)
    return (
      <section
        className="giveaway-card giveaway-card--loading"
        aria-label="Розыгрыш"
      >
        <Gift size={28} aria-hidden="true" />
        <strong>Розыгрыш</strong>
        {!viewerId ? (
          <p>Войди в Noctgram, чтобы посмотреть призы и условия.</p>
        ) : error ? (
          <>
            <p role="alert">{error}</p>
            <button className="secondary" onClick={() => retry((v) => v + 1)}>
              Попробовать снова
            </button>
          </>
        ) : (
          <LoaderCircle className="spin" size={20} aria-label="Загрузка" />
        )}
      </section>
    );
  const done = data.status === 'completed';
  const won = done && data.winners.some((winner) => winner.id === viewerId);
  return (
    <section
      className={'giveaway-card' + (done ? ' giveaway-card--complete' : '')}
      aria-label={done ? 'Итоги розыгрыша' : 'Розыгрыш'}
    >
      <div className="giveaway-art" aria-hidden="true">
        <span className="giveaway-orbit" />
        {data.prize === 'premium' ? (
          <PremiumIcon size={64} />
        ) : (
          <StarsIcon size={64} />
        )}
        <i />
        <i />
        <i />
        <i />
      </div>
      <span className="giveaway-status">
        {done ? <Trophy size={14} /> : <Gift size={14} />}
        {done ? 'Итоги розыгрыша' : 'Розыгрыш'}
      </span>
      <h3>{data.prize === 'premium' ? 'Noct Premium' : 'Noct Stars'}</h3>
      <div className="giveaway-prize-line">
        <strong>{done ? data.winners.length : data.winnerCount}</strong>
        <span>×</span>
        {data.prize === 'premium' ? (
          <>
            <PremiumIcon size={21} />
            <strong>{data.premiumDays} дней</strong>
          </>
        ) : (
          <>
            <StarsIcon size={21} />
            <strong>{number(data.starsPerWinner)}</strong>
          </>
        )}
      </div>
      {done ? (
        <>
          <p className="giveaway-subheading">
            {data.winners.length ? 'Победители' : 'Нет подходящих участников'}
          </p>
          <div className="giveaway-winners">
            {data.winners.map((winner) => (
              <ProfileLink
                key={winner.id}
                target={{ id: winner.id }}
                className="giveaway-winner"
                aria-label={'Профиль ' + winner.name}
              >
                <Avatar person={winner} size={25} />
                <span>{winner.name}</span>
              </ProfileLink>
            ))}
          </div>
          {won && (
            <div className="giveaway-membership">
              <Check size={16} />
              Ты выиграл! Приз уже зачислен.
            </div>
          )}
          {!!data.refund && (
            <p className="giveaway-note">
              Неразыгранные призы: {number(data.refund)} Noct Stars возвращено
              организатору.
            </p>
          )}
          <footer>
            <span>Завершён</span>
            <time
              dateTime={new Date(data.completedAt || data.endsAt).toISOString()}
            >
              {date(data.completedAt || data.endsAt)}
            </time>
          </footer>
        </>
      ) : (
        <>
          <div className="giveaway-countdown">
            <Clock3 size={17} />
            <strong>{remainingTime(data.endsAt, now)}</strong>
            <time dateTime={new Date(data.endsAt).toISOString()}>
              до {date(data.endsAt)}
            </time>
          </div>
          <p className="giveaway-note">
            {data.targetKind === 'group'
              ? 'Участники группы'
              : 'Подписчики канала'}{' '}
            участвуют автоматически. Нужно оставаться{' '}
            {data.targetKind === 'group' ? 'в группе' : 'подписанным'} до
            подведения итогов. Организатор не участвует.
          </p>
          <div className="giveaway-membership">
            {data.participating ? <Check size={16} /> : <Users size={16} />}
            <span>
              {data.participating
                ? 'Ты участвуешь'
                : data.creator === viewerId
                  ? 'Ты организатор'
                  : data.targetKind === 'group'
                    ? 'Вступи в группу, чтобы участвовать'
                    : 'Подпишись на канал, чтобы участвовать'}
            </span>
          </div>
          <span className="giveaway-participants">
            Участников сейчас: {number(data.participantCount)}
          </span>
        </>
      )}
      {error && (
        <output className="giveaway-error">
          Не удалось обновить данные. Проверяем ещё раз…
        </output>
      )}
    </section>
  );
}
