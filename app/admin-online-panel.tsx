'use client';
/* eslint-disable react/react-compiler */
import { useEffect, useId, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { readApiJson } from '@/lib/http-response';
import type { OnlinePoint, OnlineRange, OnlineStats } from '@/lib/online-stats';

const number = (value: number | null | undefined, fraction = false) =>
  value == null
    ? '—'
    : value.toLocaleString('ru-RU', {
        maximumFractionDigits: fraction ? 1 : 0,
      });
const time = (value: number, date = false) =>
  new Date(value).toLocaleString('ru-RU', {
    ...(date ? { day: 'numeric', month: 'short' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  });
function OnlineTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: OnlinePoint }[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point || !point.samples) return null;
  return (
    <div className="admin-online-tooltip">
      <strong>{time(point.time, true)}</strong>
      <span>
        Средний онлайн <b>{number(point.average, true)}</b>
      </span>
      <span>
        Максимум <b>{number(point.peak)}</b>
      </span>
      <span>
        Минимум <b>{number(point.minimum)}</b>
      </span>
      <small>Минутных замеров: {point.samples}</small>
    </div>
  );
}

export default function AdminOnlinePanel() {
  const [range, setRange] = useState<OnlineRange>('hour');
  const [data, setData] = useState<OnlineStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const gradient = useId().replaceAll(':', '');
  useEffect(() => {
    let live = true,
      pending = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const load = async () => {
      if (!live || pending || document.hidden) return;
      clearTimeout(timer);
      pending = true;
      setLoading(true);
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15000);
      try {
        const response = await fetch(
          '/api/social?action=adminOnline&range=' + range,
          {
            cache: 'no-store',
            signal: controller.signal,
          },
        );
        const next = await readApiJson<OnlineStats>(
          response,
          'Не удалось обновить онлайн',
        );
        if (!response.ok)
          throw new Error(next.error || 'Не удалось обновить онлайн');
        if (live) {
          setData(next);
          setError('');
        }
      } catch (e) {
        if (live)
          setError(
            (e as Error).name === 'AbortError'
              ? 'Сервер не ответил. Повторим обновление.'
              : (e as Error).message,
          );
      } finally {
        clearTimeout(timeout);
        pending = false;
        if (live) {
          setLoading(false);
          timer = setTimeout(() => void load(), 30000);
        }
      }
    };
    const visibility = () => {
      if (document.hidden) clearTimeout(timer);
      else void load();
    };
    void load();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      live = false;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [range, version]);
  const current = data?.range === range ? data : null;
  const hasHistory = current?.points.some((point) => point.samples);
  const stale =
    data?.latestSampleAt != null &&
    data.serverTime - data.latestSampleAt > 180000;
  return (
    <section className="admin-online-panel">
      <div className="account-section-heading">
        <span className="staff-heading-icon">
          <Activity size={21} />
        </span>
        <div>
          <h3>Онлайн пользователей</h3>
          <p>Аккаунты с активностью за последние 2 минуты</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Обновить онлайн"
          disabled={loading}
          onClick={() => setVersion((value) => value + 1)}
        >
          <RefreshCw size={16} className={loading ? 'spin' : undefined} />
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="admin-online-cards">
        <div className="admin-online-card admin-online-current">
          <span>
            <i /> Сейчас онлайн
          </span>
          <strong>{number(data?.online)}</strong>
          <small>Вошедшие пользователи</small>
        </div>
        <div className="admin-online-card">
          <span>Всего аккаунтов</span>
          <strong>{number(data?.registered)}</strong>
          <small>Личные профили</small>
        </div>
        <div className="admin-online-card">
          <span>Пик за сутки</span>
          <strong>{number(data?.day.peak)}</strong>
          <small>Одновременно на сайте</small>
        </div>
        <div className="admin-online-card">
          <span>Средний за сутки</span>
          <strong>{number(data?.day.average, true)}</strong>
          <small>По сохранённым замерам</small>
        </div>
      </div>
      <div className="admin-online-history">
        <div className="admin-online-chart-heading">
          <h4>История онлайна</h4>
          <span>{range === 'hour' ? 'По минутам' : 'По часам'}</span>
        </div>
        <fieldset className="admin-online-ranges" aria-label="Период графика">
          {(
            [
              ['hour', 'Час'],
              ['day', 'Сутки'],
              ['week', '7 дней'],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={range === value}
              onClick={() => setRange(value)}
            >
              {label}
            </button>
          ))}
        </fieldset>
        {hasHistory && current ? (
          <>
            <div className="admin-online-legend">
              <span>Онлайн{range !== 'hour' ? ' · средний' : ''}</span>
              {range !== 'hour' && <span>Пик за час</span>}
            </div>
            <section
              className="admin-online-chart"
              aria-label={
                'График онлайна, ' +
                (range === 'hour'
                  ? 'по минутам за последний час'
                  : range === 'day'
                    ? 'по часам за сутки'
                    : 'по часам за неделю')
              }
            >
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <ComposedChart
                  data={current.points}
                  margin={{ top: 14, right: 10, bottom: 8, left: -16 }}
                  accessibilityLayer
                >
                  <defs>
                    <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="#8ccdb4"
                        stopOpacity={0.25}
                      />
                      <stop
                        offset="100%"
                        stopColor="#8ccdb4"
                        stopOpacity={0.015}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#ffffff0d" />
                  <XAxis
                    dataKey="time"
                    tickFormatter={(value: number) =>
                      time(value, range === 'week')
                    }
                    minTickGap={35}
                    stroke="#888891"
                    tick={{ fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    domain={[0, (max: number) => Math.max(2, Math.ceil(max))]}
                    stroke="#888891"
                    tick={{ fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                  />
                  <Tooltip
                    content={<OnlineTooltip />}
                    cursor={{ stroke: '#ffffff26' }}
                  />
                  <Area
                    type="linear"
                    dataKey="average"
                    name="Онлайн"
                    stroke="#8ccdb4"
                    strokeWidth={2}
                    fill={`url(#${gradient})`}
                    connectNulls={false}
                    isAnimationActive={false}
                    dot={{ r: 2, fill: '#8ccdb4', strokeWidth: 0 }}
                  />
                  {range !== 'hour' && (
                    <Line
                      type="linear"
                      dataKey="peak"
                      stroke="#a8a1cc"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </section>
          </>
        ) : (
          <div className="admin-online-empty">
            <Activity size={28} />
            <strong>
              {loading
                ? 'Загружаем историю…'
                : 'В этом периоде пока нет замеров'}
            </strong>
            <p>История собирается раз в минуту после включения статистики.</p>
          </div>
        )}
        {stale && (
          <output className="admin-online-warning">
            Замеры истории задерживаются. Последний:{' '}
            {time(data.latestSampleAt!, true)}. Текущий онлайн рассчитывается
            отдельно.
          </output>
        )}
        <p className="admin-online-note">
          Пропуски на графике означают отсутствие замера. В почасовом виде
          показаны средний онлайн и пик, а не число уникальных посетителей.
        </p>
      </div>
      <div className="admin-online-footer">
        <span>
          {data ? 'Обновлено в ' + time(data.serverTime) : 'Получаем данные…'}
        </span>
        <span>Обновление каждые 30 секунд</span>
      </div>
      <p className="admin-online-note">
        История хранится 30 дней. Анонимные запросы не учитываются; несколько
        вкладок одного аккаунта считаются за одного пользователя.
      </p>
    </section>
  );
}
