'use client';
/* eslint-disable react/react-compiler */
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  Search,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Star,
  Sparkles,
  BadgeCheck,
  Gem,
  History,
  Check,
  ArrowUpRight,
  RefreshCw,
  Gift,
  Activity,
  Users,
  ShieldBan,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { request, type Person } from '@/lib/client';
import { Avatar, DisplayName } from './profile-identity';
import { StaffSelect } from './staff-select';
import { GratitudeBadge } from './gratitude-badge';
import { ProfileRecognitions } from './profile-recognitions';
import { AdminGiftForm } from './admin-gift-form';
import { giftDefinition } from '@/lib/gift-catalog';
const AdminOnlinePanel = lazy(() => import('./admin-online-panel'));
const AdminAccessPanel = lazy(() => import('./admin-access-panel'));
type AdminPerson = Person & {
  administrator: number;
  moderator: number;
  balance: number;
};
type Event = Person & {
  id: string;
  action: string;
  amount: number;
  reason: string;
  created: number;
  actorName: string;
  payload?: string;
};
const actions = [
  { value: 'stars', label: 'Выдать Stars', icon: Star },
  { value: 'premium', label: 'Выдать Premium', icon: Sparkles },
  { value: 'collectible', label: 'Выдать подарки', icon: Gift },
  { value: 'verified', label: 'Верификация', icon: BadgeCheck },
  { value: 'gratitude', label: 'Знак благодарности', icon: Gem },
  { value: 'moderator', label: 'Роль модератора', icon: ShieldCheck },
];
function roleLabel(person: AdminPerson) {
  return person.administrator
    ? 'Администратор'
    : person.moderator
      ? 'Модератор'
      : person.kind === 'channel'
        ? 'Канал'
        : 'Пользователь';
}
function giftEventDetails(event: Event) {
  try {
    const p = JSON.parse(event.payload || '{}');
    if (
      !p.giftId ||
      !Number.isSafeInteger(p.firstNumber) ||
      !Number.isSafeInteger(p.count)
    )
      return '';
    const last = p.firstNumber + p.count - 1;
    return `${giftDefinition(p.giftId)?.name || p.giftId} · #${p.firstNumber}${last !== p.firstNumber ? '–#' + last : ''} · ${p.attributes?.model?.name || ''} / ${p.attributes?.backdrop?.name || ''} / ${p.attributes?.symbol?.name || ''}`;
  } catch {
    return '';
  }
}
export function AdministrationPanel({ onChanged }: { onChanged: () => void }) {
  const [tab, setTab] = useState('people');
  const [locked, setLocked] = useState(false);
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (!locked) setTab(String(value));
      }}
      className="admin-sections"
    >
      <TabsList
        className="admin-section-tabs"
        aria-label="Разделы администрирования"
      >
        <TabsTrigger value="people" disabled={locked}>
          <Users size={16} /> Пользователи
        </TabsTrigger>
        <TabsTrigger value="online" disabled={locked}>
          <Activity size={16} /> Онлайн
        </TabsTrigger>
        <TabsTrigger value="access" disabled={locked}>
          <ShieldBan size={16} /> Антиспам
        </TabsTrigger>
      </TabsList>
      <TabsContent value="people" keepMounted>
        <AdministrationAccounts
          onChanged={onChanged}
          active={tab === 'people'}
          onLocked={setLocked}
        />
      </TabsContent>
      <TabsContent value="online">
        <Suspense fallback={<p className="meta">Загружаем статистику…</p>}>
          <AdminOnlinePanel />
        </Suspense>
      </TabsContent>
      <TabsContent value="access">
        <Suspense fallback={<p className="meta">Загружаем блокировки…</p>}>
          <AdminAccessPanel onLocked={setLocked} />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}
function AdministrationAccounts({
  onChanged,
  active,
  onLocked,
}: {
  onChanged: () => void;
  active: boolean;
  onLocked: (locked: boolean) => void;
}) {
  const [query, setQuery] = useState(''),
    [people, setPeople] = useState<AdminPerson[]>([]),
    [events, setEvents] = useState<Event[]>([]),
    [selected, setSelected] = useState<AdminPerson | null>(null);
  const [kind, setKind] = useState('stars'),
    [amount, setAmount] = useState('1000'),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [giftLocked, setGiftLocked] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [version, setVersion] = useState(0),
    [loading, setLoading] = useState(true);
  const lock = useRef(false),
    pending = useRef<{ body: string; id: string } | null>(null);
  useEffect(() => {
    onLocked(busy || giftLocked);
  }, [busy, giftLocked, onLocked]);
  useEffect(() => {
    if (!active) return;
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      void request<{ people: AdminPerson[]; events: Event[] }>(
        '?action=administration&q=' + encodeURIComponent(query),
      )
        .then((r) => {
          if (live) {
            setError('');
            setPeople(r.people);
            setEvents(r.events);
            setSelected((old) =>
              old ? r.people.find((p) => p.id === old.id) || old : null,
            );
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, version, active]);
  const submit = async () => {
    if (!selected || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const body = {
      action: 'adminGrant',
      target: selected.id,
      kind,
      amount: Number(amount),
      reason: reason.trim(),
    };
    const fingerprint = JSON.stringify(body);
    if (pending.current?.body !== fingerprint)
      pending.current = { body: fingerprint, id: crypto.randomUUID() };
    try {
      await request('', { ...body, requestId: pending.current.id });
      pending.current = null;
      setNotice('Изменение сохранено и записано в журнал.');
      setVersion((v) => v + 1);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const stateOptions =
    kind === 'verified'
      ? [
          { value: '1', label: 'Подтвердить аккаунт' },
          { value: '0', label: 'Снять верификацию' },
        ]
      : kind === 'gratitude'
        ? [
            { value: '1', label: 'Выдать знак' },
            { value: '0', label: 'Снять знак' },
          ]
        : [
            { value: '1', label: 'Назначить модератором' },
            { value: '0', label: 'Снять роль модератора' },
          ];
  const ActionIcon = actions.find((a) => a.value === kind)?.icon || ShieldCheck;
  const submitLabel =
    kind === 'stars'
      ? 'Выдать Stars'
      : kind === 'premium'
        ? 'Выдать Premium'
        : stateOptions.find((o) => o.value === amount)?.label || 'Сохранить';
  return (
    <section className="administration-panel">
      <div className="account-section-heading">
        <span className="staff-heading-icon">
          <ShieldCheck size={21} />
        </span>
        <div>
          <h3>Администрирование</h3>
          <p>Stars, Premium, подарки, знаки и полномочия пользователей</p>
        </div>
        <button
          className="icon-button"
          aria-label="Обновить администрирование"
          title="Обновить"
          disabled={loading || busy}
          onClick={() => setVersion((v) => v + 1)}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="moderation-notice">{notice}</output>}
      {!selected ? (
        <>
          <label className="staff-search">
            <Search size={17} />
            <input
              aria-label="Найти получателя"
              placeholder="Имя, основной или дополнительный @юзернейм"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {loading && <output className="meta">Ищем аккаунты…</output>}
          <div className="admin-people">
            {people.map((p) => (
              <button
                key={p.id}
                className="admin-person"
                onClick={() => {
                  setSelected(p);
                  if (p.kind === 'channel') {
                    setKind('verified');
                    setAmount('1');
                  }
                  setError('');
                  setNotice('');
                }}
              >
                <Avatar person={p} />
                <span className="staff-person-copy">
                  <DisplayName person={p} />
                  <small>@{p.handle}</small>
                </span>
                <span className="staff-status">{roleLabel(p)}</span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
          {!loading && !people.length && (
            <p className="moderation-empty">
              Никого не нашли. Попробуйте другой юзернейм.
            </p>
          )}
        </>
      ) : (
        <form
          className="admin-grant-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (kind !== 'collectible') void submit();
          }}
        >
          <fieldset disabled={busy}>
            <button
              type="button"
              className="account-text-button"
              disabled={giftLocked}
              onClick={() => {
                setSelected(null);
                setNotice('');
              }}
            >
              <ChevronLeft size={16} /> Другой получатель
            </button>
            <div className="admin-target">
              <Avatar person={selected} size={48} />
              <div className="staff-person-copy">
                <DisplayName person={selected} />
                <p>@{selected.handle}</p>
                <span className="staff-status">{roleLabel(selected)}</span>
              </div>
              {selected.kind !== 'channel' && (
                <div className="admin-balance">
                  <span>
                    <Star size={14} />
                    {selected.balance.toLocaleString('ru-RU')}
                  </span>
                  <small>баланс Stars</small>
                </div>
              )}
            </div>
            <div className="staff-field-grid">
              <StaffSelect
                label="Действие"
                value={kind}
                options={
                  selected.kind === 'channel'
                    ? actions.filter((a) => a.value === 'verified')
                    : actions
                }
                disabled={busy || giftLocked}
                onChange={(v) => {
                  setKind(v);
                  setAmount(
                    v === 'stars' ? '1000' : v === 'premium' ? '30' : '1',
                  );
                  setNotice('');
                }}
              />
              {kind === 'stars' || kind === 'premium' ? (
                <label className="account-field">
                  {kind === 'stars' ? 'Количество Stars' : 'Дней Premium'}
                  <input
                    type="number"
                    min={1}
                    max={kind === 'stars' ? 1000000 : 365}
                    step={1}
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
              ) : kind !== 'collectible' ? (
                <StaffSelect
                  label="Состояние"
                  value={amount}
                  options={stateOptions}
                  onChange={setAmount}
                  disabled={busy}
                />
              ) : null}
            </div>
            {kind === 'collectible' ? (
              <AdminGiftForm
                key={selected.id}
                target={selected.id}
                handle={selected.handle}
                onLock={setGiftLocked}
                onIssued={() => {
                  setVersion((v) => v + 1);
                  onChanged();
                }}
              />
            ) : (
              <>
                {kind === 'gratitude' && (
                  <div className="admin-gratitude-preview">
                    <div className="admin-gratitude-caption">
                      <span>Предпросмотр знака</span>
                      <span>{selected.gratitude ? 'Выдан' : 'Не выдан'}</span>
                    </div>
                    <div className="admin-gratitude-name">
                      <span>{selected.name}</span>
                      <GratitudeBadge person={selected} />
                    </div>
                    <ProfileRecognitions
                      person={{ ...selected, gratitude: true }}
                      compact
                    />
                  </div>
                )}
                <label className="account-field">
                  <span className="staff-field-caption">
                    Причина <small>{reason.length}/500</small>
                  </span>
                  <textarea
                    required
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    placeholder={
                      kind === 'stars' || kind === 'premium'
                        ? 'Например, награда за помощь в тестировании'
                        : kind === 'verified'
                          ? 'Например, подтверждён официальный аккаунт автора'
                          : kind === 'gratitude'
                            ? 'За что благодарим или почему снимаем знак'
                            : 'Например, назначение в команду модерации'
                    }
                  />
                </label>
                <div className="admin-grant-summary">
                  <span className="staff-summary-icon">
                    <ActionIcon size={20} />
                  </span>
                  <div>
                    <strong>После подтверждения</strong>
                    <p>
                      {kind === 'stars'
                        ? `@${selected.handle} получит ${Number(amount || 0).toLocaleString('ru-RU')} Stars.`
                        : kind === 'premium'
                          ? `Premium для @${selected.handle} будет продлён на ${amount} дн.`
                          : kind === 'verified'
                            ? `${amount === '1' ? 'Подтвердить' : 'Снять подтверждение'} @${selected.handle}.`
                            : kind === 'gratitude'
                              ? `${amount === '1' ? 'Выдать знак «С благодарностью» пользователю' : 'Снять знак «С благодарностью» у'} @${selected.handle}.`
                              : `${amount === '1' ? 'Назначить модератором' : 'Снять роль модератора у'} @${selected.handle}.`}
                    </p>
                  </div>
                </div>
                <div className="staff-form-footer">
                  <span>
                    <History size={14} /> Сохраним в журнале
                  </span>
                  <button className="primary" disabled={!reason.trim() || busy}>
                    <Check size={16} />
                    {busy ? 'Сохраняем…' : submitLabel}
                  </button>
                </div>
              </>
            )}
          </fieldset>
        </form>
      )}
      <div className="admin-journal">
        <h4>
          <History size={16} />
          Последние действия
        </h4>
        {events.map((e) => (
          <article key={e.id}>
            <div>
              <strong>
                {actions.find((a) => a.value === e.action)?.label ||
                  'Изменение аккаунта'}{' '}
                {e.action === 'stars'
                  ? `+${e.amount.toLocaleString('ru-RU')}`
                  : e.action === 'premium'
                    ? `+${e.amount} дн.`
                    : e.action === 'collectible'
                      ? `· ${e.amount} шт.`
                      : e.amount
                        ? '· включено'
                        : '· снято'}
              </strong>
              <time>{new Date(e.created).toLocaleString('ru-RU')}</time>
            </div>
            <p>
              {e.actorName} → {e.handle ? '@' + e.handle : e.name}
            </p>
            <small>{e.reason}</small>
            {e.action === 'collectible' && (
              <small className="admin-gift-journal-details">
                {giftEventDetails(e)}
              </small>
            )}
          </article>
        ))}
        {!events.length && (
          <div className="staff-empty">
            <ArrowUpRight size={22} />
            <p>Пока без изменений</p>
            <small>Выдачи и изменения ролей появятся здесь.</small>
          </div>
        )}
      </div>
    </section>
  );
}
