'use client';
/* Payment retries keep the same persisted request key until the server confirms the outcome. */
/* eslint-disable react/react-compiler */
import { useEffect, useId, useRef, useState } from 'react';
import { Gift, LoaderCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { createGiveaway, type GiveawayDraft } from '@/lib/giveaways-client';
import {
  GIVEAWAY_PREMIUM_COST,
  GIVEAWAY_PREMIUM_DAYS,
} from '@/lib/giveaways-types';
import { readApiJson } from '@/lib/http-response';
import { StarsIcon } from './stars-icon';
import { PremiumIcon } from './premium-icon';

const localDate = (value: number) =>
  new Date(value - new Date(value).getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
const earliestEnd = () =>
  localDate(Math.ceil((Date.now() + 5 * 60000) / 60000) * 60000);
const storage = (key: string, draft: GiveawayDraft | null) => {
  try {
    if (draft) sessionStorage.setItem(key, JSON.stringify(draft));
    else sessionStorage.removeItem(key);
  } catch {
    /* The in-memory key still protects retries. */
  }
};
export function GiveawayCreateButton({
  targetKind,
  targetId,
  targetName,
  actorId,
  disabled,
  compact = false,
  onCreated,
}: {
  targetKind: 'group' | 'channel';
  targetId: string;
  targetName: string;
  actorId: string;
  disabled?: boolean;
  compact?: boolean;
  onCreated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={compact ? 'icon-button' : 'secondary'}
        title="Создать розыгрыш"
        aria-label="Создать розыгрыш"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Gift size={compact ? 19 : 15} />
        {!compact && 'Розыгрыш'}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="noct-dialog giveaway-dialog">
          <DialogTitle>Создать розыгрыш</DialogTitle>
          <DialogDescription>
            {targetName} ·{' '}
            {targetKind === 'group'
              ? 'среди участников группы'
              : 'среди подписчиков канала'}
          </DialogDescription>
          {open && (
            <GiveawayForm
              key={actorId + ':' + targetId}
              targetKind={targetKind}
              targetId={targetId}
              actorId={actorId}
              onCreated={() => {
                setOpen(false);
                onCreated?.();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function GiveawayForm({
  targetKind,
  targetId,
  actorId,
  onCreated,
}: {
  targetKind: 'group' | 'channel';
  targetId: string;
  actorId: string;
  onCreated: () => void;
}) {
  const id = useId(),
    key =
      'noctgram:giveaway-draft:' + actorId + ':' + targetKind + ':' + targetId;
  const [prize, setPrize] = useState<'stars' | 'premium'>('stars');
  const [count, setCount] = useState('3'),
    [stars, setStars] = useState('100');
  const [ends, setEnds] = useState(() => localDate(Date.now() + 86400000));
  const [balance, setBalance] = useState<number | null>(null),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false);
  const [walletRevision, retryWallet] = useState(0);
  const attempt = useRef<GiveawayDraft | null>(null),
    lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(key) || 'null',
      ) as GiveawayDraft | null;
      if (
        saved &&
        saved.actor === actorId &&
        saved.targetId === targetId &&
        saved.targetKind === targetKind &&
        typeof saved.key === 'string' &&
        /^[a-zA-Z0-9-]{16,80}$/.test(saved.key) &&
        ['stars', 'premium'].includes(saved.prize) &&
        Number.isSafeInteger(saved.winnerCount) &&
        Number.isSafeInteger(saved.starsPerWinner) &&
        Number.isSafeInteger(saved.endsAt)
      ) {
        attempt.current = saved;
        setPending(true);
        setPrize(saved.prize);
        setCount(String(saved.winnerCount));
        setStars(String(saved.starsPerWinner));
        setEnds(localDate(saved.endsAt));
      }
    } catch {
      /* Ignore damaged local preferences. Server validates every submitted value. */
    }
    return () => {
      alive.current = false;
    };
  }, [key, actorId, targetId, targetKind]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/gifts?action=catalog', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await readApiJson<{ balance: number }>(
          response,
          'Не удалось загрузить баланс',
        );
        if (!response.ok)
          throw new Error(data.error || 'Не удалось загрузить баланс');
        if (alive.current) setBalance(data.balance);
      })
      .catch((cause) => {
        if (alive.current && !controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Не удалось загрузить баланс',
          );
      });
    return () => controller.abort();
  }, [walletRevision]);
  const winnerCount = Number(count),
    starsPerWinner = Number(stars),
    endsAt = new Date(ends).getTime();
  const perWinner =
    prize === 'premium' ? GIVEAWAY_PREMIUM_COST : starsPerWinner;
  const cost = winnerCount * perWinner;
  const valid =
    Number.isSafeInteger(winnerCount) &&
    winnerCount >= 1 &&
    winnerCount <= 50 &&
    Number.isSafeInteger(perWinner) &&
    perWinner >= 1 &&
    perWinner <= 100000 &&
    cost <= 1000000 &&
    Number.isFinite(endsAt) &&
    endsAt >= Date.now() + 5 * 60000 &&
    endsAt <= Date.now() + 30 * 86400000;
  const insufficient = balance !== null && cost > balance;
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      lock.current ||
      (!attempt.current && (!valid || balance === null || insufficient))
    )
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    const draft = attempt.current ?? {
      actor: actorId,
      key: crypto.randomUUID(),
      targetKind,
      targetId,
      prize,
      winnerCount,
      starsPerWinner: prize === 'premium' ? 0 : starsPerWinner,
      endsAt,
    };
    attempt.current = draft;
    setPending(true);
    storage(key, draft);
    try {
      const result = await createGiveaway(draft);
      storage(key, null);
      attempt.current = null;
      window.dispatchEvent(new Event('noctgram:gifts-changed'));
      if (alive.current) {
        setBalance(result.balance);
        setPending(false);
        onCreated();
      }
    } catch (cause) {
      if ((cause as { code?: string }).code === 'GIVEAWAY_REJECTED') {
        storage(key, null);
        attempt.current = null;
        if (alive.current) setPending(false);
      }
      if (alive.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Не удалось создать розыгрыш',
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <form className="giveaway-form" onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy || pending}>
        <legend>Что разыгрываем</legend>
        <RadioGroup
          value={prize}
          onValueChange={(value) => setPrize(value as 'stars' | 'premium')}
          className="giveaway-prize-options"
          aria-label="Приз"
        >
          <label
            htmlFor={id + '-prize-stars'}
            className={
              'giveaway-option' + (prize === 'stars' ? ' selected' : '')
            }
          >
            <StarsIcon size={30} />
            <span>
              <strong>Noct Stars</strong>
              <small>Звёзды на баланс</small>
            </span>
            <RadioGroupItem id={id + '-prize-stars'} value="stars" />
          </label>
          <label
            htmlFor={id + '-prize-premium'}
            className={
              'giveaway-option' + (prize === 'premium' ? ' selected' : '')
            }
          >
            <PremiumIcon size={30} />
            <span>
              <strong>Noct Premium</strong>
              <small>
                {GIVEAWAY_PREMIUM_DAYS} дней · {GIVEAWAY_PREMIUM_COST} Noct
                Stars
              </small>
            </span>
            <RadioGroupItem id={id + '-prize-premium'} value="premium" />
          </label>
        </RadioGroup>
        <div className="giveaway-fields">
          <label htmlFor={id + '-count'}>
            Победителей
            <input
              id={id + '-count'}
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              step={1}
              value={count}
              onChange={(event) => setCount(event.target.value)}
              required
            />
          </label>
          {prize === 'stars' && (
            <label htmlFor={id + '-stars'}>
              Noct Stars каждому
              <input
                id={id + '-stars'}
                type="number"
                inputMode="numeric"
                min={1}
                max={100000}
                step={1}
                value={stars}
                onChange={(event) => setStars(event.target.value)}
                required
              />
            </label>
          )}
        </div>
        <label className="giveaway-date" htmlFor={id + '-ends'}>
          Подведение итогов
          <input
            id={id + '-ends'}
            type="datetime-local"
            value={ends}
            min={earliestEnd()}
            max={localDate(Date.now() + 30 * 86400000)}
            onChange={(event) => setEnds(event.target.value)}
            required
          />
          <small>В твоём часовом поясе · от 5 минут до 30 дней</small>
        </label>
        <div className="giveaway-duration">
          {[1, 6, 24, 72, 168].map((hours) => (
            <button
              type="button"
              key={hours}
              onClick={() => setEnds(localDate(Date.now() + hours * 3600000))}
            >
              {hours < 24 ? hours + ' ч' : hours / 24 + ' д'}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="giveaway-total">
        <span>Спишется с твоего баланса</span>
        <strong>
          <StarsIcon size={23} />
          {Number.isSafeInteger(cost) && cost > 0
            ? cost.toLocaleString('ru-RU')
            : '—'}{' '}
          <small>Noct Stars</small>
        </strong>
        <span>
          На балансе:{' '}
          {balance === null ? 'загрузка…' : balance.toLocaleString('ru-RU')}
        </span>
      </div>
      <p className="giveaway-terms">
        Призы оплачиваются сразу.{' '}
        {targetKind === 'group' ? 'Участники группы' : 'Подписчики канала'}{' '}
        участвуют автоматически, кроме организатора. Победители определяются
        случайно в указанное время. Стоимость неразыгранных призов вернётся на
        твой баланс.
      </p>
      {prize === 'premium' && (
        <p className="giveaway-terms">
          Действующий Premium победителя продлится ещё на{' '}
          {GIVEAWAY_PREMIUM_DAYS} дней.
        </p>
      )}
      {pending && (
        <output className="giveaway-terms">
          Проверим ранее отправленный запрос. Повторное нажатие не спишет звёзды
          ещё раз.
        </output>
      )}
      {error && (
        <p className="giveaway-error" role="alert">
          {error}
        </p>
      )}
      {!pending &&
        (!Number.isFinite(endsAt) ||
          endsAt < Date.now() + 5 * 60000 ||
          endsAt > Date.now() + 30 * 86400000) && (
          <output className="giveaway-error">
            Выбери время завершения: от 5 минут до 30 дней от текущего момента.
          </output>
        )}
      {!pending && cost > 1000000 && (
        <output className="giveaway-error">
          Максимальный бюджет — 1 000 000 Noct Stars.
        </output>
      )}
      {balance === null && error && (
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setError('');
            retryWallet((v) => v + 1);
          }}
        >
          Обновить баланс
        </button>
      )}
      {insufficient && !pending && (
        <output className="giveaway-error">
          Не хватает {(cost - balance!).toLocaleString('ru-RU')} Noct Stars.
        </output>
      )}
      <button
        type="submit"
        className="primary giveaway-submit"
        disabled={
          busy || (!pending && (!valid || balance === null || insufficient))
        }
      >
        {busy ? (
          <>
            <LoaderCircle size={17} className="spin" />
            Создаём…
          </>
        ) : pending ? (
          'Проверить и завершить создание'
        ) : (
          <>
            <Gift size={17} />
            Оплатить и начать розыгрыш
          </>
        )}
      </button>
    </form>
  );
}
