'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clock, RefreshCw, Shield, ShieldAlert, X } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { request } from '@/lib/client';
import type { SpamReview, SpamSettings } from '@/lib/antispam-types';
import { StaffSelect } from './staff-select';

const statuses = [
  { value: 'pending', label: 'Ожидают проверки' },
  { value: 'approved', label: 'Одобрены' },
  { value: 'rejected', label: 'Отклонены' },
];
const kindLabel = { post: 'Лента', comment: 'Комментарий', group: 'Группа' };
type Page = { items: SpamReview[]; hasMore: boolean; settings: SpamSettings };
export function AntispamPanel({
  canAdmin,
  onAccount,
  onChanged,
}: {
  canAdmin: boolean;
  onAccount: (id: string, handle: string) => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState('pending');
  const [items, setItems] = useState<SpamReview[]>([]);
  const [settings, setSettings] = useState<SpamSettings | null>(null);
  const [domains, setDomains] = useState('');
  const [raid, setRaid] = useState(false);
  const [raidActive, setRaidActive] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const live = useRef(false),
    generation = useRef(0),
    lock = useRef(false);
  const cursor = useRef<SpamReview | undefined>(undefined),
    initialized = useRef(false);
  const applySettings = useCallback((value: SpamSettings) => {
    initialized.current = true;
    setSettings(value);
    setDomains(value.domains.join('\n'));
    setRaid(value.raidUntil > Date.now());
    setRaidActive(value.raidUntil > Date.now());
  }, []);
  const load = useCallback(
    async (append = false, reloadSettings = false) => {
      const gen = ++generation.current;
      setLoading(true);
      setError('');
      const query = new URLSearchParams({ action: 'spamQueue', status });
      if (append && cursor.current) {
        query.set('before', String(cursor.current.created));
        query.set('beforeId', cursor.current.id);
      }
      try {
        const page = await request<Page>('?' + query);
        if (!live.current || generation.current !== gen) return;
        setItems((old) =>
          append
            ? [
                ...old,
                ...page.items.filter(
                  (item) => !old.some((prev) => prev.id === item.id),
                ),
              ]
            : page.items,
        );
        cursor.current = page.items.at(-1);
        setHasMore(page.hasMore);
        if (!initialized.current || reloadSettings)
          applySettings(page.settings);
      } catch (e) {
        if (live.current && generation.current === gen)
          setError((e as Error).message);
      } finally {
        if (live.current && generation.current === gen) setLoading(false);
      }
    },
    [status, applySettings],
  );
  useEffect(() => {
    live.current = true;
    generation.current++;
    const timer = setTimeout(() => {
      setItems([]);
      setHasMore(false);
      void load();
    }, 0);
    return () => {
      live.current = false;
      clearTimeout(timer);
    };
  }, [load]);
  async function mutate(
    body: unknown,
    message: string,
    updateSettings = false,
  ) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request<SpamSettings>('', body);
      if (!live.current) return;
      if (updateSettings) applySettings(result);
      setNotice(message);
      await load();
      onChanged();
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  }
  return (
    <div className="antispam-panel">
      <div className="antispam-settings">
        <div className="antispam-title">
          <Shield size={20} />
          <div>
            <h3>Защита от спама</h3>
            <p>Проверка рекламы и повторов в ленте, комментариях и группах.</p>
          </div>
        </div>
        <label className="antispam-raid" htmlFor="antispam-raid-toggle">
          <span>
            <strong>Антирейд</strong>
            <small>
              На 24 часа. Первая публичная отправка новых аккаунтов — после
              проверки, остальные — с увеличенным интервалом.
            </small>
          </span>
          <Switch
            id="antispam-raid-toggle"
            checked={raid}
            onCheckedChange={setRaid}
            disabled={!canAdmin || !settings || busy}
            aria-label="Антирейд"
          />
        </label>
        {settings && raidActive && (
          <p className="antispam-active">
            <Clock size={14} /> Включён до{' '}
            {new Date(settings.raidUntil).toLocaleString('ru-RU')}
          </p>
        )}
        {canAdmin ? (
          <>
            <label className="antispam-domains">
              Рекламные домены
              <textarea
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
                disabled={!settings || busy}
                maxLength={12700}
                rows={3}
                spellCheck={false}
                placeholder="example.com — по одному в строке"
              />
            </label>
            <p>
              Учитываются скрытые символы, похожие буквы и кодированные ссылки.
              Домены также проверяются в именах, юзернеймах и описаниях.
            </p>
            <div className="antispam-actions">
              <button
                className="primary-button"
                disabled={!settings || busy}
                onClick={() =>
                  void mutate(
                    {
                      action: 'spamSettings',
                      domains: domains.split(/[\s,;]+/).filter(Boolean),
                      raid,
                      expectedUpdated: settings?.updated,
                    },
                    'Настройки защиты сохранены',
                    true,
                  )
                }
              >
                Сохранить защиту
              </button>
              <button
                className="secondary-button"
                disabled={busy || loading}
                onClick={() => void load(false, true)}
              >
                Перезагрузить настройки
              </button>
            </div>
          </>
        ) : (
          <p>Изменить режим и список доменов может администратор.</p>
        )}
      </div>
      <div className="antispam-toolbar">
        <StaffSelect
          label="Очередь модерации"
          value={status}
          options={statuses}
          disabled={busy}
          onChange={setStatus}
        />
        <button
          className="icon-button"
          aria-label="Обновить очередь"
          disabled={loading || busy}
          onClick={() => void load()}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="moderation-notice">{notice}</output>}
      {loading && !items.length ? (
        <output>Загрузка очереди…</output>
      ) : (
        !items.length && (
          <div className="antispam-empty">
            <Shield size={28} />
            <strong>Здесь пока пусто</strong>
            <p>
              {status === 'pending'
                ? 'Подозрительные отправки появятся здесь. Пока они не одобрены, их не видят другие пользователи.'
                : 'В этом разделе нет рассмотренных отправок.'}
            </p>
          </div>
        )
      )}
      {items.map((item) => (
        <article className="antispam-item" key={item.id}>
          <div className="antispam-item-heading">
            <div>
              <strong>{item.name}</strong>
              <span>{item.handle ? '@' + item.handle : 'Без юзернейма'}</span>
            </div>
            <span className="antispam-kind">{kindLabel[item.kind]}</span>
          </div>
          <p className="antispam-context">
            {item.contextName || 'Место публикации удалено'} ·{' '}
            {new Date(item.created).toLocaleString('ru-RU')}
          </p>
          <ul className="antispam-reasons">
            {item.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <pre className="antispam-text">
            {item.text.trim() || 'Вложение без подписи'}
          </pre>
          {item.payload.media && item.payload.media !== '[]' && (
            <p className="antispam-context">
              Есть вложения. Они сохранятся при одобрении.
            </p>
          )}
          {item.status === 'pending' ? (
            <>
              <label className="antispam-note">
                Комментарий к решению
                <textarea
                  value={notes[item.id] || ''}
                  maxLength={500}
                  rows={2}
                  disabled={busy}
                  onChange={(e) =>
                    setNotes((old) => ({ ...old, [item.id]: e.target.value }))
                  }
                  placeholder="Необязательно"
                />
              </label>
              <div className="antispam-actions">
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      {
                        action: 'spamReview',
                        id: item.id,
                        decision: 'approve',
                        note: notes[item.id] || '',
                      },
                      'Отправка одобрена',
                    )
                  }
                >
                  <Check size={16} /> Одобрить
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      {
                        action: 'spamReview',
                        id: item.id,
                        decision: 'reject',
                        note: notes[item.id] || '',
                      },
                      'Отправка отклонена',
                    )
                  }
                >
                  <X size={16} /> Отклонить
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => onAccount(item.actorId, item.handle || '')}
                >
                  <ShieldAlert size={16} /> Ограничить автора
                </button>
              </div>
            </>
          ) : (
            <p className="antispam-context">
              {item.status === 'approved' ? 'Одобрено' : 'Отклонено'} ·{' '}
              {new Date(item.reviewedAt).toLocaleString('ru-RU')}
              {item.note && ' · ' + item.note}
            </p>
          )}
        </article>
      ))}
      {hasMore && (
        <button
          className="secondary-button"
          disabled={loading || busy}
          onClick={() => void load(true)}
        >
          Загрузить ещё
        </button>
      )}
    </div>
  );
}
