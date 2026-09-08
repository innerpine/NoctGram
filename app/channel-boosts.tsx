'use client';
/* Async reads and writes share a generation guard; dialog content survives its exit. */
/* eslint-disable react/react-compiler */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  Film,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Orbit,
  Palette,
  RefreshCw,
  Sparkles,
  Type,
  X,
  Zap,
} from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { request, type Person, type Profile } from '@/lib/client';
import { Avatar, DisplayName } from './profile-identity';

export type ChannelBoostSlot = {
  slot: 1 | 2 | 3 | 4;
  channelId: string | null;
  channel: Person | null;
  availableAt: number;
};
export type ChannelBoostState = {
  channelId: string;
  count: number;
  level: number;
  maxLevel: 5;
  perLevel: 4;
  currentThreshold: number;
  nextThreshold: number | null;
  premium: boolean;
  premiumExpiresAt: number | null;
  serverTime: number;
  slots: ChannelBoostSlot[];
  canManage: boolean;
  boosters: (Person & { boosts: number })[];
};
type Props = {
  channel: Profile;
  me: Profile;
  onChanged: (profile: Profile) => void;
  onPremium: () => void;
  onProfile: (id: string) => void;
  disabled?: boolean;
  initialOpen?: boolean;
  onClosed?: () => void;
};
const rewards = [
  { level: 1, title: 'Цвета канала', icon: Palette },
  { level: 2, title: 'Градиентное имя', icon: Type },
  { level: 3, title: 'Обводка Chrome Flow', icon: Sparkles },
  { level: 4, title: 'Текст вокруг аватара', icon: Orbit },
  { level: 5, title: 'Анимированный аватар', icon: Film },
];
const flights = [
  [-78, -38, -26],
  [-51, -64, 20],
  [-22, -82, -16],
  [18, -76, 25],
  [52, -62, -28],
  [79, -34, 20],
  [-68, 10, 18],
  [66, 13, -22],
];
function plural(value: number, one: string, few: string, many: string) {
  const n = Math.abs(value) % 100;
  return n > 10 && n < 20
    ? many
    : n % 10 === 1
      ? one
      : n % 10 >= 2 && n % 10 <= 4
        ? few
        : many;
}
function boosts(value: number) {
  return `${value} ${plural(value, 'усиление', 'усиления', 'усилений')}`;
}
function monotonicNow() {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
function remaining(until: number, now: number) {
  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function activePremium(data: ChannelBoostState, now: number) {
  return (
    data.premium &&
    (data.premiumExpiresAt === null || data.premiumExpiresAt > now)
  );
}
function selectionKey(data: ChannelBoostState, ids: number[]) {
  return [...ids]
    .sort((a, b) => a - b)
    .map((id) => {
      const slot = data.slots.find((s) => s.slot === id);
      return `${id}:${slot?.channelId || ''}:${slot?.availableAt ?? ''}`;
    })
    .join('|');
}

/** Keying isolates late requests when the viewer or channel changes. Import the CSS in layout. */
export function ChannelBoosts(props: Props) {
  return (
    <ChannelBoostPanel key={`${props.me.id}:${props.channel.id}`} {...props} />
  );
}
function ChannelBoostPanel({
  channel,
  me,
  onChanged,
  onPremium,
  onProfile,
  disabled = false,
  initialOpen = false,
  onClosed,
}: Props) {
  const [open, setOpen] = useState(initialOpen),
    [data, setData] = useState<ChannelBoostState | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<number[]>([]),
    [confirmation, setConfirmation] = useState<string | null>(null),
    [error, setError] = useState(''),
    [readError, setReadError] = useState(''),
    [notice, setNotice] = useState(''),
    [fallbackLink, setFallbackLink] = useState(''),
    [clock, setClock] = useState(0),
    [celebration, setCelebration] = useState(0);
  const mounted = useRef(false),
    generation = useRef(0),
    reading = useRef<number | null>(null),
    locked = useRef(false),
    current = useRef<ChannelBoostState | null>(null),
    serverClock = useRef({ time: 0, received: 0 }),
    afterClose = useRef<(() => void) | null>(null),
    slotLegend = useId(),
    rewardsTitle = useId(),
    confirmationTitle = useId(),
    formHint = useId();
  const serverNow = useCallback(() => {
    const base = serverClock.current;
    return base.time + Math.max(0, monotonicNow() - base.received);
  }, []);
  const accept = useCallback((next: ChannelBoostState) => {
    current.current = next;
    serverClock.current = { time: next.serverTime, received: monotonicNow() };
    setClock(next.serverTime);
    setData(next);
    setSelected((old) =>
      old.filter(
        (id) =>
          activePremium(next, next.serverTime) &&
          next.slots.some(
            (s) =>
              s.slot === id &&
              s.channelId !== next.channelId &&
              s.availableAt <= next.serverTime,
          ),
      ),
    );
  }, []);
  const refresh = useCallback(async () => {
    if (!mounted.current || locked.current || reading.current !== null) return;
    const version = ++generation.current;
    reading.current = version;
    setLoading(true);
    try {
      const next = await request<ChannelBoostState>(
        '?action=boosts&id=' + encodeURIComponent(channel.id),
      );
      if (
        !mounted.current ||
        version !== generation.current ||
        next.channelId !== channel.id
      )
        return;
      accept(next);
      setReadError('');
    } catch (e) {
      if (mounted.current && version === generation.current)
        setReadError((e as Error).message || 'Не удалось загрузить усиления.');
    } finally {
      if (reading.current === version) reading.current = null;
      if (mounted.current && version === generation.current) setLoading(false);
    }
  }, [channel.id, accept]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      // This is a request generation counter, not a DOM node ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++generation.current;
      reading.current = null;
      afterClose.current = null;
    };
  }, [refresh]);
  useEffect(() => {
    if (mounted.current) void refresh();
  }, [me.premium, refresh]);
  useEffect(() => {
    // The profile CTA remains visible when its dialog is closed.
    const resume = () => {
      if (!document.hidden) void refresh();
    };
    const poll = window.setInterval(resume, 15000);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      clearInterval(poll);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [refresh]);
  useEffect(() => {
    if (!open) return;
    const tick = () => {
      if (!document.hidden) setClock(serverNow());
    };
    tick();
    if (!document.hidden) void refresh();
    const timer = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [open, refresh, serverNow]);
  useEffect(() => {
    if (!celebration) return;
    const timer = setTimeout(() => setCelebration(0), 1150);
    return () => clearTimeout(timer);
  }, [celebration]);

  const premium = !!data && activePremium(data, clock),
    chosen = data?.slots.filter((s) => selected.includes(s.slot)) || [],
    signature = data ? selectionKey(data, selected) : '',
    confirming =
      !!confirmation && confirmation === signature && chosen.length > 0,
    mine = data?.slots.filter((s) => s.channelId === channel.id).length || 0,
    selectable =
      data?.slots.filter(
        (s) => s.channelId !== channel.id && s.availableAt <= clock,
      ) || [],
    nextThreshold = data?.nextThreshold ?? null,
    progress = data
      ? nextThreshold === null
        ? 100
        : Math.max(
            0,
            Math.min(
              100,
              ((data.count - data.currentThreshold) /
                Math.max(1, nextThreshold - data.currentThreshold)) *
                100,
            ),
          )
      : 0;
  const transfers = new Map<
    string,
    { channel: Person | null; count: number }
  >();
  for (const slot of chosen) {
    if (!slot.channelId || slot.channelId === channel.id) continue;
    const old = transfers.get(slot.channelId);
    transfers.set(slot.channelId, {
      channel: slot.channel,
      count: (old?.count || 0) + 1,
    });
  }
  const transferCount = [...transfers.values()].reduce(
    (sum, entry) => sum + entry.count,
    0,
  );
  const isSelectable = (slot: ChannelBoostSlot) =>
    premium &&
    !disabled &&
    !busy &&
    slot.channelId !== channel.id &&
    slot.availableAt <= clock;

  function navigateAfterClose(action: () => void) {
    afterClose.current = action;
    setOpen(false);
  }
  async function copyLink() {
    const link = `${window.location.origin}/?boost=${encodeURIComponent(channel.id)}`;
    const version = generation.current;
    try {
      await navigator.clipboard.writeText(link);
      if (mounted.current && version === generation.current) {
        setFallbackLink('');
        setNotice('Ссылка на усиление скопирована.');
      }
    } catch {
      if (mounted.current) setFallbackLink(link);
    }
  }
  async function submit(expectedSignature: string) {
    if (!mounted.current || locked.current || disabled || !selected.length)
      return;
    const snapshot = current.current;
    const now = serverNow();
    const ids = [...new Set(selected)].sort((a, b) => a - b);
    if (
      !snapshot ||
      !activePremium(snapshot, now) ||
      selectionKey(snapshot, ids) !== expectedSignature ||
      ids.some(
        (id) =>
          !snapshot.slots.some(
            (s) =>
              s.slot === id &&
              s.channelId !== channel.id &&
              s.availableAt <= now,
          ),
      )
    ) {
      setConfirmation(null);
      setError('Слоты изменились. Проверь выбор ещё раз.');
      void refresh();
      return;
    }
    locked.current = true;
    const version = ++generation.current;
    reading.current = null;
    setBusy(true);
    setLoading(false);
    setError('');
    setNotice('');
    let reconcile = false;
    try {
      const next = await request<ChannelBoostState & { profile: Profile }>('', {
        action: 'boost',
        id: channel.id,
        slots: ids,
      });
      if (
        !mounted.current ||
        version !== generation.current ||
        next.channelId !== channel.id
      )
        return;
      accept(next);
      setSelected([]);
      setConfirmation(null);
      setReadError('');
      setNotice('Канал усилен. Спасибо за поддержку!');
      setCelebration((value) => value + 1);
      onChanged(next.profile);
    } catch (e) {
      if (mounted.current && version === generation.current) {
        setError(
          (e as Error).message || 'Не удалось усилить канал. Попробуй ещё раз.',
        );
        setConfirmation(null);
        reconcile = true;
      }
    } finally {
      if (mounted.current && version === generation.current) {
        locked.current = false;
        setBusy(false);
        if (reconcile) void refresh();
      }
    }
  }
  return (
    <>
      <button
        type="button"
        className="channel-boosts-cta"
        onClick={() => {
          afterClose.current = null;
          setOpen(true);
        }}
      >
        <span className="channel-boosts-cta-icon" aria-hidden="true">
          <Zap size={20} />
        </span>
        <span className="channel-boosts-cta-copy">
          <strong>Усилить канал</strong>
          <small>
            {data
              ? `Уровень ${data.level} · ${boosts(data.count)}`
              : 'Открой новые возможности вместе с подписчиками'}
          </small>
        </span>
        <ChevronRight size={17} aria-hidden="true" />
      </button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (value) afterClose.current = null;
          setOpen(value);
        }}
        onOpenChangeComplete={(value) => {
          if (!value) {
            const action = afterClose.current;
            afterClose.current = null;
            onClosed?.();
            action?.();
          }
        }}
      >
        <DialogContent
          className="noct-dialog channel-boosts-dialog"
          showCloseButton={false}
        >
          <DialogClose
            render={
              <button
                type="button"
                className="channel-boosts-close"
                aria-label="Закрыть усиления канала"
              />
            }
          >
            <X size={19} />
          </DialogClose>
          <header className="channel-boosts-hero">
            <div className="channel-boosts-emblem-area" aria-hidden="true">
              <span
                key={`emblem-${celebration}`}
                className={
                  'channel-boosts-emblem' +
                  (celebration ? ' is-celebrating' : '')
                }
              >
                <Zap size={37} strokeWidth={1.5} />
              </span>
              {!!celebration && (
                <span key={celebration} className="channel-boosts-burst">
                  {flights.map(([x, y, turn], index) => (
                    <span
                      key={index}
                      style={
                        {
                          '--boost-x': `${x}px`,
                          '--boost-y': `${y}px`,
                          '--boost-turn': `${turn}deg`,
                          '--boost-delay': `${index * 24}ms`,
                        } as CSSProperties
                      }
                    >
                      <Zap size={index % 2 ? 12 : 16} />
                    </span>
                  ))}
                </span>
              )}
            </div>
            <DialogTitle>Больше возможностей канала</DialogTitle>
            <DialogDescription>
              Усиливай любимый канал и открывай оформление и истории для его
              авторов.
            </DialogDescription>
            <span className="channel-boosts-channel">
              <Avatar person={channel} size={24} />
              <DisplayName person={channel} />
            </span>
          </header>
          {!data && loading && (
            <output className="channel-boosts-loading">
              <LoaderCircle size={18} className="spin" aria-hidden="true" />{' '}
              Загружаем усиления…
            </output>
          )}
          {data && (
            <>
              <section
                className="channel-boosts-progress"
                aria-label="Уровень канала"
              >
                <div>
                  <strong>Уровень {data.level}</strong>
                  <span>
                    <Zap size={13} aria-hidden="true" /> {boosts(data.count)}
                  </span>
                </div>
                <progress
                  className="channel-boosts-meter"
                  max={100}
                  value={progress}
                  aria-label="Усиления канала"
                  aria-valuetext={
                    nextThreshold === null
                      ? `Максимальный уровень, ${boosts(data.count)}`
                      : `${boosts(data.count)} из ${nextThreshold} до уровня ${data.level + 1}`
                  }
                />
                <p>
                  {nextThreshold === null ? (
                    'Все возможности открыты. Канал по-прежнему можно поддерживать.'
                  ) : (
                    <>
                      Ещё{' '}
                      <strong>
                        {boosts(Math.max(0, nextThreshold - data.count))}
                      </strong>{' '}
                      до уровня {data.level + 1}
                    </>
                  )}
                </p>
              </section>
              {premium ? (
                <section
                  className="channel-boosts-selection"
                  aria-labelledby={slotLegend}
                >
                  <div className="channel-boosts-section-heading">
                    <h3 id={slotLegend}>Твои 4 усиления</h3>
                    <span>{mine ? `${mine} уже здесь` : 'Noct Premium'}</span>
                  </div>
                  <p id={formHint} className="channel-boosts-note">
                    Выбери один или несколько слотов. Их можно отдать одному
                    каналу или распределить между разными.
                  </p>
                  <fieldset
                    className="channel-boosts-slots"
                    aria-labelledby={slotLegend}
                    aria-describedby={formHint}
                  >
                    {data.slots.map((slot) => {
                      const here = slot.channelId === channel.id,
                        picked = selected.includes(slot.slot),
                        cooling = slot.availableAt > clock;
                      return (
                        <button
                          key={slot.slot}
                          type="button"
                          aria-pressed={here || picked}
                          aria-label={`Усиление ${slot.slot}: ${here ? 'уже у этого канала' : slot.channel?.name || (slot.channelId ? 'канал недоступен' : 'свободно')}${cooling ? `, перенос через ${remaining(slot.availableAt, clock)}` : ''}`}
                          className={
                            'channel-boosts-slot' +
                            (here ? ' is-here' : '') +
                            (picked ? ' is-selected' : '')
                          }
                          disabled={!isSelectable(slot)}
                          onClick={() => {
                            if (!isSelectable(slot)) return;
                            setSelected((old) =>
                              old.includes(slot.slot)
                                ? old.filter((id) => id !== slot.slot)
                                : [...old, slot.slot],
                            );
                            setConfirmation(null);
                            setError('');
                            setNotice('');
                          }}
                        >
                          <span
                            className="channel-boosts-slot-number"
                            aria-hidden="true"
                          >
                            {here ? <Zap size={16} /> : slot.slot}
                          </span>
                          <span className="channel-boosts-slot-copy">
                            <strong>
                              {here ? (
                                'Усиливает этот канал'
                              ) : slot.channel ? (
                                <DisplayName person={slot.channel} />
                              ) : slot.channelId ? (
                                'Канал недоступен'
                              ) : (
                                'Свободное усиление'
                              )}
                            </strong>
                            <small aria-live="off">
                              {cooling ? (
                                <>
                                  <Clock3 size={11} aria-hidden="true" />{' '}
                                  Перенос через{' '}
                                  {remaining(slot.availableAt, clock)}
                                </>
                              ) : here ? (
                                'Уже добавлено'
                              ) : slot.channelId ? (
                                'Можно перенести сюда'
                              ) : (
                                'Готово к использованию'
                              )}
                            </small>
                          </span>
                          <span
                            className="channel-boosts-slot-check"
                            aria-hidden="true"
                          >
                            {here || picked ? (
                              <Check size={13} />
                            ) : cooling ? (
                              <LockKeyhole size={12} />
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </fieldset>
                  <p className="channel-boosts-note">
                    После назначения каждый слот можно перенести снова через 24
                    часа. Усиления действуют, пока активен Noct Premium.
                  </p>
                  {disabled && (
                    <p className="channel-boosts-note">
                      Усиления сейчас недоступны для этого аккаунта.
                    </p>
                  )}
                  {!disabled && !selectable.length && (
                    <p className="channel-boosts-note">
                      {mine === 4
                        ? 'Все твои усиления уже поддерживают этот канал.'
                        : 'Все слоты заняты. Дождись окончания времени переноса.'}
                    </p>
                  )}
                  {confirming && (
                    <section
                      className="channel-boosts-confirm"
                      aria-labelledby={confirmationTitle}
                    >
                      <h4 id={confirmationTitle}>
                        Перенести {boosts(transferCount)}?
                      </h4>
                      <p>
                        Эти каналы потеряют твои усиления. Если их станет
                        недостаточно, уровень и доступные возможности снизятся.
                      </p>
                      <ul>
                        {[...transfers.entries()].map(([id, entry]) => (
                          <li key={id}>
                            <span>
                              {entry.channel ? (
                                <DisplayName person={entry.channel} />
                              ) : (
                                'Канал недоступен'
                              )}
                            </span>
                            <strong>
                              −{entry.count}{' '}
                              <Zap size={12} aria-hidden="true" />
                            </strong>
                          </li>
                        ))}
                      </ul>
                      <p className="channel-boosts-transfer-destination">
                        <ArrowRight size={15} aria-hidden="true" />
                        <span>
                          Здесь добавится {boosts(chosen.length)}. Следующий
                          перенос — через 24 часа.
                        </span>
                      </p>
                      <div className="channel-boosts-actions">
                        <button
                          type="button"
                          className="channel-boosts-primary"
                          disabled={busy || disabled || !premium}
                          onClick={() => void submit(signature)}
                        >
                          {busy ? (
                            <LoaderCircle size={16} className="spin" />
                          ) : (
                            <Zap size={16} />
                          )}{' '}
                          Подтвердить перенос
                        </button>
                        <button
                          type="button"
                          className="channel-boosts-secondary"
                          disabled={busy}
                          onClick={() => setConfirmation(null)}
                        >
                          Отмена
                        </button>
                      </div>
                    </section>
                  )}
                  {!confirming && (
                    <button
                      type="button"
                      className="channel-boosts-primary channel-boosts-submit"
                      disabled={busy || disabled || !chosen.length || !premium}
                      onClick={() => {
                        if (transferCount) setConfirmation(signature);
                        else void submit(signature);
                      }}
                    >
                      {busy ? (
                        <LoaderCircle
                          size={17}
                          className="spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Zap size={17} aria-hidden="true" />
                      )}
                      {busy
                        ? 'Усиливаем…'
                        : chosen.length
                          ? `Усилить · +${chosen.length}`
                          : 'Выбери усиления'}
                    </button>
                  )}
                </section>
              ) : (
                <section className="channel-boosts-premium">
                  <span aria-hidden="true">
                    <Sparkles size={21} />
                  </span>
                  <div>
                    <h3>4 усиления с Noct Premium</h3>
                    <p>
                      Поддерживай любимые каналы и открывай им новые
                      возможности.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="channel-boosts-secondary"
                    onClick={() => navigateAfterClose(onPremium)}
                  >
                    О Noct Premium <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </section>
              )}
            </>
          )}
          {(error || readError) && (
            <div className="channel-boosts-error" role="alert">
              <p>{error || readError}</p>
              {readError && (
                <button
                  type="button"
                  className="channel-boosts-text-button"
                  disabled={busy || loading}
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={13} aria-hidden="true" /> Повторить
                </button>
              )}
            </div>
          )}
          {notice && (
            <output className="channel-boosts-notice">
              <Check size={15} aria-hidden="true" /> {notice}
            </output>
          )}
          <button
            type="button"
            className="channel-boosts-link"
            onClick={() => void copyLink()}
          >
            <Link2 size={16} aria-hidden="true" />
            <span>Скопировать ссылку на усиление</span>
          </button>
          {fallbackLink && (
            <label className="channel-boosts-copy-fallback">
              <span>Скопируй ссылку вручную</span>
              <input
                value={fallbackLink}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
                aria-label="Ссылка на усиление канала"
              />
            </label>
          )}
          <section
            className="channel-boosts-rewards"
            aria-labelledby={rewardsTitle}
          >
            <div className="channel-boosts-section-heading">
              <h3 id={rewardsTitle}>Что открывают уровни</h3>
              <span>По {data?.perLevel ?? 4} усиления</span>
            </div>
            <ol>
              {rewards.map(({ level, title, icon: Icon }) => {
                const unlocked = !!data && data.level >= level;
                return (
                  <li key={level} className={unlocked ? 'is-unlocked' : ''}>
                    <span
                      className="channel-boosts-reward-icon"
                      aria-hidden="true"
                    >
                      <Icon size={18} />
                    </span>
                    <div>
                      <strong>{title}</strong>
                      <small>
                        {level} {plural(level, 'история', 'истории', 'историй')}{' '}
                        в день
                      </small>
                    </div>
                    <span className="channel-boosts-reward-level">
                      {unlocked ? (
                        <>
                          <Check size={12} aria-hidden="true" /> Открыто
                        </>
                      ) : (
                        <>
                          Ур. {level}
                          <small>
                            {level * (data?.perLevel ?? 4)}{' '}
                            <Zap size={10} aria-hidden="true" />
                          </small>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
          {data?.canManage && (
            <section className="channel-boosts-supporters">
              <div className="channel-boosts-section-heading">
                <h3>Кто усилил канал</h3>
                <span>Последние 20</span>
              </div>
              {data.boosters.length ? (
                <ul>
                  {data.boosters.slice(0, 20).map((person) => (
                    <li key={person.id}>
                      <button
                        type="button"
                        onClick={() =>
                          navigateAfterClose(() => onProfile(person.id))
                        }
                      >
                        <Avatar person={person} size={32} />
                        <span>
                          <DisplayName person={person} />
                          <small>@{person.handle}</small>
                        </span>
                        <strong>
                          {person.boosts} <Zap size={13} aria-hidden="true" />
                        </strong>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="channel-boosts-note">
                  Пока никто не усилил канал.
                </p>
              )}
            </section>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
