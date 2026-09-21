'use client';
/* eslint-disable react/react-compiler, next/no-html-link-for-pages */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  ArrowLeft,
  Briefcase,
  Check,
  ChevronRight,
  House,
  LayoutGrid,
  Lock,
  Search,
  SearchX,
  Wallet,
  WifiOff,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Profile } from '@/lib/client';
import { giftRarity } from '@/lib/gift-collectibles';
import {
  MARKET_FEE_PERCENT,
  marketApi,
  type MarketApiError,
  type MarketCatalog,
  type MarketFacet,
  type MarketKind,
  type MarketLot,
  type MarketPerson,
  type MarketRow,
} from '@/lib/market-policy';
import {
  Assets,
  GiftArt,
  MarketLink,
  SellDialog,
  Stars,
  kindLabels,
  kindOrder,
  num,
  type Go,
} from './market-assets';
import { Avatar } from './profile-identity';
import { NoctLogo, StarsIcon } from './stars-icon';

type Viewer = { me: Profile; balance: number };
const rise = (i: number) => ({ '--i': i }) as CSSProperties;
const day = (time: number) =>
  new Date(time).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
const isKind = (value: string | null): value is MarketKind =>
  kindOrder.includes(value as MarketKind);

// The market is a standalone page: its views live in the query string and
// never enter the main app's history adapter.
function useMarketRoute() {
  const [search, setSearch] = useState('');
  useEffect(() => {
    const sync = () => setSearch(window.location.search);
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const go = useCallback<Go>((params) => {
    const query = new URLSearchParams(params).toString();
    window.history.pushState(null, '', '/market' + (query ? '?' + query : ''));
    setSearch(query ? '?' + query : '');
    window.scrollTo(0, 0);
  }, []);
  return [new URLSearchParams(search), go] as const;
}

function Person({ person }: { person: MarketPerson | null }) {
  return person ? (
    <span className="mk-who">
      <Avatar person={person} size={28} />
      <span>{person.name}</span>
      {person.handle && <span className="mk-meta">@{person.handle}</span>}
    </span>
  ) : (
    <span className="mk-t48">Скрытый аккаунт</span>
  );
}
function Failure({ text, retry }: { text: string; retry: () => void }) {
  return (
    <div className="mk-card mk-empty" role="alert">
      <WifiOff size={40} strokeWidth={1.4} />
      <h2 className="mk-h2">Не удалось загрузить</h2>
      <p className="mk-meta">{text}</p>
      <button className="mk-btn mk-btn-sec" onClick={retry}>
        Повторить
      </button>
    </div>
  );
}

function Facets({
  title,
  items,
  value,
  onChange,
}: {
  title: string;
  items: MarketFacet[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (!items.length) return null;
  return (
    <>
      <div className="mk-fhead">
        <span>{title}</span>
        {value && <button onClick={() => onChange('')}>Сбросить</button>}
      </div>
      {items.map((item) => (
        <button
          key={item.id}
          className={'mk-frow' + (item.id === value ? ' on' : '')}
          aria-pressed={item.id === value}
          onClick={() => onChange(item.id === value ? '' : item.id)}
        >
          <span className="mk-box">
            {item.id === value && <Check size={12} strokeWidth={3} />}
          </span>
          <span className="mk-frow-name">{item.name}</span>
          {item.rarityPermille !== undefined && (
            <span className="mk-rar">{giftRarity(item.rarityPermille)}</span>
          )}
          <span className="mk-cnt">{num(item.count)}</span>
        </button>
      ))}
    </>
  );
}

function Catalog({
  tab,
  go,
  query,
  setQuery,
}: {
  tab: MarketKind;
  go: Go;
  query: string;
  setQuery: (value: string) => void;
}) {
  const [status, setStatus] = useState('all'),
    [sort, setSort] = useState('recent'),
    [family, setFamily] = useState(''),
    [attrs, setAttrs] = useState({ model: '', backdrop: '', symbol: '' }),
    [search, setSearch] = useState(query.trim()),
    [data, setData] = useState<MarketCatalog | null>(null),
    [rows, setRows] = useState<MarketRow[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const version = useRef(0),
    shown = useRef(0);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const load = useCallback(
    async (append: boolean) => {
      const generation = ++version.current;
      setLoading(true);
      try {
        const next = await marketApi<MarketCatalog>(
          '?' +
            new URLSearchParams({
              action: 'catalog',
              kind: tab,
              status,
              sort,
              q: search,
              family,
              ...attrs,
              offset: String(append ? shown.current : 0),
            }),
        );
        if (generation !== version.current) return;
        setData(next);
        setRows((old) => {
          const merged = append ? [...old, ...next.rows] : next.rows;
          shown.current = merged.length;
          return merged;
        });
        setError('');
      } catch (e) {
        if (generation === version.current) setError((e as Error).message);
      } finally {
        if (generation === version.current) setLoading(false);
      }
    },
    [tab, status, sort, search, family, attrs],
  );
  useEffect(() => void load(false), [load]);
  const statuses =
    tab === 'gift'
      ? [
          ['all', 'Все'],
          ['sale', 'Продаётся'],
          ['idle', 'Не продаётся'],
        ]
      : [
          ['all', 'Все'],
          ['sale', 'Продаётся'],
          ['sold', 'Продано'],
        ];
  const filtered =
    !!search ||
    status !== 'all' ||
    !!family ||
    Object.values(attrs).some(Boolean);
  const reset = () => {
    setQuery('');
    setStatus('all');
    setFamily('');
    setAttrs({ model: '', backdrop: '', symbol: '' });
  };
  const statusLabel = (row: MarketRow) =>
    row.status === 'sale'
      ? 'Продаётся'
      : row.status === 'sold'
        ? 'Продано · ' + day(row.closed)
        : 'Не продаётся';
  return (
    <main className="mk-wrap">
      <label className="mk-search mk-search-m">
        <Search size={18} />
        <input
          type="search"
          placeholder="Имя, номер или подарок"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="mk-head mk-rise">
        <div>
          <h1 className="mk-h1">Каталог</h1>
          <p className="mk-meta">
            Коллекционные юзернеймы, анонимные номера и подарки. Все цены в
            Stars.
          </p>
        </div>
        <div className="mk-tabs" role="tablist" aria-label="Разделы каталога">
          {kindOrder.map((kind) => (
            <MarketLink
              key={kind}
              to={{ tab: kind }}
              go={go}
              className={'mk-tab' + (kind === tab ? ' on' : '')}
            >
              {kindLabels[kind]}
              {data && <span className="mk-cnt">{num(data.counts[kind])}</span>}
            </MarketLink>
          ))}
        </div>
      </div>
      <div className="mk-toolbar mk-rise" style={rise(1)}>
        <div className="mk-chips">
          {statuses.map(([id, label]) => (
            <button
              key={id}
              className={'mk-chip' + (status === id ? ' on' : '')}
              aria-pressed={status === id}
              onClick={() => setStatus(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          className="mk-chip"
          aria-label="Сортировка"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="recent">Недавние</option>
          <option value="priceAsc">Цена ↑</option>
          <option value="priceDesc">Цена ↓</option>
        </select>
      </div>
      {error ? (
        <Failure text={error} retry={() => void load(false)} />
      ) : (
        <div className={tab === 'gift' ? 'mk-gifts' : undefined}>
          {tab === 'gift' && !!data?.families?.length && (
            <aside className="mk-card mk-filters mk-rise" aria-label="Фильтры">
              <Facets
                title="Коллекция"
                items={data.families}
                value={family}
                onChange={(id) => {
                  setFamily(id);
                  setAttrs({ model: '', backdrop: '', symbol: '' });
                }}
              />
              {(['model', 'backdrop', 'symbol'] as const).map((name) => (
                <Facets
                  key={name}
                  title={
                    { model: 'Модель', backdrop: 'Фон', symbol: 'Узор' }[name]
                  }
                  items={data.attributes?.[name] || []}
                  value={attrs[name]}
                  onChange={(id) => setAttrs((old) => ({ ...old, [name]: id }))}
                />
              ))}
            </aside>
          )}
          {!rows.length && loading ? (
            <div className="mk-card-flat" style={{ flex: 1 }} aria-busy="true">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div className="mk-row" key={i}>
                  <span className="mk-sk" style={{ width: '55%' }} />
                  <span className="mk-sk" style={{ width: '45%' }} />
                  <span className="mk-sk mk-r" style={{ width: 80 }} />
                  <span />
                </div>
              ))}
            </div>
          ) : !rows.length ? (
            <div className="mk-card mk-empty" style={{ flex: 1 }}>
              <SearchX size={40} strokeWidth={1.4} />
              <h2 className="mk-h2">
                {filtered ? 'Ничего не нашли' : 'Лотов пока нет'}
              </h2>
              <p className="mk-meta">
                {filtered
                  ? 'Попробуйте изменить запрос или сбросить фильтры.'
                  : 'Новые лоты появятся здесь, как только их выпустят.'}
              </p>
              {filtered && (
                <button className="mk-btn mk-btn-sec" onClick={reset}>
                  Сбросить фильтры
                </button>
              )}
            </div>
          ) : tab === 'gift' ? (
            <div className="mk-grid">
              {rows.map((row, i) => (
                <MarketLink
                  key={row.key}
                  to={{ lot: row.kind, key: row.key }}
                  go={go}
                  className="mk-gcard mk-rise"
                  style={rise(Math.min(i, 12))}
                >
                  {row.gift && <GiftArt gift={row.gift} />}
                  <div className="mk-gcard-name">
                    {row.gift?.name}{' '}
                    <span className="mk-num">#{row.gift?.number}</span>
                  </div>
                  <div className="mk-gcard-foot">
                    {row.price ? (
                      <Stars value={row.price} />
                    ) : (
                      <span className="mk-t48">—</span>
                    )}
                    <span className={'mk-st mk-st-' + row.status}>
                      <i />
                      {statusLabel(row)}
                    </span>
                  </div>
                </MarketLink>
              ))}
            </div>
          ) : (
            <div className="mk-card-flat">
              <div className="mk-row mk-row-head">
                <span>Лот</span>
                <span>Статус</span>
                <span className="mk-r">Цена</span>
                <span />
              </div>
              {rows.map((row, i) => (
                <MarketLink
                  key={row.key + row.closed}
                  to={{ lot: row.kind, key: row.key }}
                  go={go}
                  className={
                    'mk-row mk-rise' + (row.status === 'sold' ? ' mk-sold' : '')
                  }
                  style={rise(Math.min(i, 12))}
                >
                  <span className="mk-lot">{row.title}</span>
                  <span className={'mk-st mk-st-' + row.status}>
                    <i />
                    {statusLabel(row)}
                  </span>
                  <span className="mk-r">
                    <Stars value={row.price || 0} dim={row.status === 'sold'} />
                  </span>
                  <ChevronRight size={16} className="mk-chev mk-t48" />
                </MarketLink>
              ))}
            </div>
          )}
        </div>
      )}
      {!!rows.length && !error && (
        <div className="mk-more">
          <p className="mk-meta mk-num">Показано {num(rows.length)}</p>
          {data?.more && (
            <button
              className="mk-btn mk-btn-sec mk-btn-sm"
              disabled={loading}
              onClick={() => void load(true)}
            >
              {loading ? 'Загружаем…' : 'Показать ещё'}
            </button>
          )}
        </div>
      )}
    </main>
  );
}

function Lot({
  kind,
  lotKey,
  go,
  viewer,
  readOnly,
  onBalance,
}: {
  kind: MarketKind;
  lotKey: string;
  go: Go;
  viewer: Viewer;
  readOnly: boolean;
  onBalance: (balance: number) => void;
}) {
  const [lot, setLot] = useState<MarketLot | null>(null),
    [error, setError] = useState(''),
    [dialog, setDialog] = useState<'confirm' | 'success' | 'short' | null>(
      null,
    ),
    [paid, setPaid] = useState(0),
    [busy, setBusy] = useState(false),
    [selling, setSelling] = useState(false);
  const load = useCallback(async () => {
    try {
      setLot(
        await marketApi<MarketLot>(
          '?' + new URLSearchParams({ action: 'lot', kind, key: lotKey }),
        ),
      );
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [kind, lotKey]);
  useEffect(() => void load(), [load]);
  const back = (
    <MarketLink to={{ tab: kind }} go={go} className="mk-back">
      <ArrowLeft size={16} /> {kindLabels[kind]}
    </MarketLink>
  );
  if (error && !lot)
    return (
      <main className="mk-wrap">
        {back}
        <Failure text={error} retry={() => void load()} />
      </main>
    );
  if (!lot)
    return (
      <main className="mk-wrap" aria-busy="true">
        {back}
        <div className="mk-card mk-hero">
          <span className="mk-sk" style={{ width: 90, height: 28 }} />
          <span className="mk-sk" style={{ width: '60%', height: 52 }} />
          <span className="mk-sk" style={{ width: '80%' }} />
        </div>
      </main>
    );
  const price = lot.listing?.price || 0,
    system = !!lot.listing?.system,
    canWithdraw = lot.mine || (system && !!viewer.me.canAdmin);
  const buy = async () => {
    if (!lot.listing) return;
    setBusy(true);
    try {
      const result = await marketApi<{ balance: number }>('', {
        action: 'buy',
        listingId: lot.listing.id,
        expectedPrice: price,
      });
      setPaid(price);
      onBalance(result.balance);
      setDialog('success');
      await load();
    } catch (e) {
      const failure = e as MarketApiError;
      if (failure.code === 'INSUFFICIENT_STARS') setDialog('short');
      else {
        setDialog(null);
        setError(failure.message);
        void load();
      }
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async () => {
    setBusy(true);
    try {
      await marketApi('', { action: 'cancel', listingId: lot.listing?.id });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const status = (
    <span className={'mk-pill' + (lot.listing ? ' mk-st-sale' : '')}>
      {lot.listing ? 'Продаётся' : 'Не продаётся'}
    </span>
  );
  const side = (
    <>
      {lot.listing ? (
        <div>
          <p className="mk-meta">Цена</p>
          <Stars value={price} large />
          <p className="mk-meta">Фиксированная цена · без торгов</p>
        </div>
      ) : (
        <p className="mk-t60">
          {lot.mine
            ? 'Лот принадлежит вам и сейчас не продаётся.'
            : 'Владелец пока не выставил этот лот на продажу.'}
        </p>
      )}
      {lot.listing && !lot.mine && (
        <button
          className="mk-btn mk-btn-pri mk-btn-lg mk-btn-block"
          disabled={readOnly || busy}
          onClick={() =>
            setDialog(viewer.balance < price ? 'short' : 'confirm')
          }
        >
          Купить
        </button>
      )}
      {lot.mine && !lot.listing && (
        <button
          className="mk-btn mk-btn-pri mk-btn-block"
          disabled={readOnly}
          onClick={() => setSelling(true)}
        >
          Выставить на продажу
        </button>
      )}
      {lot.listing && canWithdraw && (
        <button
          className="mk-btn mk-btn-sec mk-btn-block"
          disabled={readOnly || busy}
          onClick={() => void withdraw()}
        >
          Снять с продажи
        </button>
      )}
      <div className="mk-divider" />
      <div>
        <p className="mk-meta">Владелец</p>
        {system || (!lot.owner && !lot.mine && kind !== 'gift') ? (
          <span>
            {system ? 'Маркет · первичный выпуск' : 'Скрыт владельцем'}
          </span>
        ) : (
          <Person person={lot.owner} />
        )}
      </div>
      {lot.listing && !lot.mine && (
        <p className="mk-note">
          {kind === 'number'
            ? 'После покупки номер привяжется к аккаунту и появится в профиле.'
            : kind === 'username'
              ? 'После покупки юзернейм станет вашим дополнительным именем.'
              : 'После покупки подарок появится в вашем профиле.'}{' '}
          {system
            ? 'Продавец — Маркет, комиссии нет.'
            : `Продавец получит сумму за вычетом комиссии ${MARKET_FEE_PERCENT}%.`}
        </p>
      )}
    </>
  );
  const history = (
    <section className="mk-card-flat mk-rise" style={rise(3)}>
      <div className="mk-section-head">
        <h2 className="mk-h2">История продаж</h2>
        <span className="mk-meta mk-num">{lot.history.length}</span>
      </div>
      {lot.history.length ? (
        lot.history.map((sale) => (
          <div className="mk-row mk-row-history" key={sale.closed}>
            <span className="mk-t60">{day(sale.closed)}</span>
            <span className="mk-who-line">
              {sale.system ? (
                <span className="mk-t60">Первичный выпуск</span>
              ) : (
                <Person person={sale.seller} />
              )}
              <span className="mk-t48">→</span>
              <Person person={sale.buyer} />
            </span>
            <span className="mk-r">
              <Stars value={sale.price} />
            </span>
          </div>
        ))
      ) : (
        <p className="mk-meta" style={{ padding: 16 }}>
          Этот лот ещё не продавался.
        </p>
      )}
    </section>
  );
  return (
    <main className="mk-wrap">
      {back}
      {error && (
        <p className="mk-banner mk-error" role="alert">
          {error}
        </p>
      )}
      {lot.gift ? (
        <>
          <div className="mk-gift-layout">
            <div className="mk-rise" style={rise(1)}>
              <GiftArt gift={lot.gift} size="lg" />
            </div>
            <div className="mk-gift-info mk-rise" style={rise(2)}>
              <h1 className="mk-h1">
                {lot.gift.name}{' '}
                <span className="mk-t48 mk-num">#{lot.gift.number}</span>
              </h1>
              {status}
              <div className="mk-card" style={{ padding: '8px 20px' }}>
                {(
                  [
                    ['Модель', lot.gift.attributes.model],
                    ['Фон', lot.gift.attributes.backdrop],
                    ['Узор', lot.gift.attributes.symbol],
                  ] as const
                ).map(([label, attribute]) => (
                  <div className="mk-attr" key={label}>
                    <span>{label}</span>
                    <span className="mk-med">
                      {attribute.name}
                      <span className="mk-rar">
                        {giftRarity(attribute.rarityPermille)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              {side}
            </div>
          </div>
          {history}
        </>
      ) : (
        <div className="mk-lot-layout">
          <div className="mk-lot-main">
            <section className="mk-card mk-hero mk-rise" style={rise(1)}>
              {status}
              <h1 className="mk-big">{lot.title}</h1>
              <p className="mk-meta">
                {kind === 'number'
                  ? 'Анонимный номер · привязывается к аккаунту и показывается в профиле'
                  : `Коллекционный юзернейм · ${lot.key.length} символов`}
              </p>
              <div className="mk-stats">
                <div>
                  <span className="mk-meta">Выпущен</span>
                  <span className="mk-h2 mk-num">{day(lot.issued)}</span>
                </div>
                <div>
                  <span className="mk-meta">Продаж</span>
                  <span className="mk-h2 mk-num">{lot.history.length}</span>
                </div>
              </div>
            </section>
            {history}
          </div>
          <aside className="mk-card mk-lot-side mk-rise" style={rise(2)}>
            {side}
          </aside>
        </div>
      )}
      <Dialog open={!!dialog} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="noct-dialog mk-dlg">
          {dialog === 'confirm' && (
            <div className="mk-dlg-body">
              <DialogTitle>Подтвердите покупку</DialogTitle>
              <DialogDescription>{lot.title}</DialogDescription>
              <div className="mk-card">
                <div className="mk-kv">
                  <span>Цена</span>
                  <Stars value={price} />
                </div>
                <div className="mk-kv">
                  <span>Баланс сейчас</span>
                  <Stars value={viewer.balance} dim />
                </div>
                <div className="mk-kv">
                  <span>Баланс после покупки</span>
                  <Stars value={viewer.balance - price} />
                </div>
              </div>
              <div className="mk-dlg-actions">
                <button
                  className="mk-btn mk-btn-sec"
                  onClick={() => setDialog(null)}
                >
                  Отмена
                </button>
                <button
                  className="mk-btn mk-btn-pri"
                  disabled={busy}
                  onClick={() => void buy()}
                >
                  {busy ? 'Покупаем…' : 'Купить'}
                </button>
              </div>
            </div>
          )}
          {dialog === 'success' && (
            <div className="mk-dlg-body">
              <div className="mk-dlg-center">
                <span className="mk-dlg-icon">
                  <Check size={26} />
                </span>
                <DialogTitle>Покупка совершена</DialogTitle>
                <DialogDescription>
                  {lot.title} теперь ваш
                  {kind === 'gift' ? ' и появится в профиле.' : '.'}
                </DialogDescription>
              </div>
              <div className="mk-card">
                <div className="mk-kv">
                  <span>Цена</span>
                  <Stars value={paid} />
                </div>
                <div className="mk-kv">
                  <span>Баланс</span>
                  <Stars value={viewer.balance} />
                </div>
              </div>
              <MarketLink
                to={{ view: 'assets' }}
                go={go}
                className="mk-btn mk-btn-pri mk-btn-block"
              >
                К моим активам
              </MarketLink>
            </div>
          )}
          {dialog === 'short' && (
            <div className="mk-dlg-body">
              <DialogTitle>Недостаточно Stars</DialogTitle>
              <DialogDescription>
                Для покупки «{lot.title}» нужно {num(price)} Stars.
              </DialogDescription>
              <div className="mk-card">
                <div className="mk-kv">
                  <span>Нужно</span>
                  <Stars value={price} />
                </div>
                <div className="mk-kv">
                  <span>На балансе</span>
                  <Stars value={viewer.balance} dim />
                </div>
                <div className="mk-kv">
                  <span>Не хватает</span>
                  <span className="mk-red mk-med mk-num">
                    {num(Math.max(price - viewer.balance, 0))}
                  </span>
                </div>
              </div>
              <div className="mk-dlg-actions">
                <button
                  className="mk-btn mk-btn-sec"
                  onClick={() => setDialog(null)}
                >
                  Понятно
                </button>
                <a className="mk-btn mk-btn-pri" href="/?page=stars">
                  Пополнить Stars
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <SellDialog
        asset={selling ? lot : null}
        onClose={() => setSelling(false)}
        onDone={() => {
          setSelling(false);
          void load();
        }}
      />
    </main>
  );
}

export default function Market() {
  const [params, go] = useMarketRoute();
  const [viewer, setViewer] = useState<Viewer | null>(null),
    [gate, setGate] = useState<'loading' | 'guest' | 'error'>('loading'),
    [gateError, setGateError] = useState(''),
    [query, setQuery] = useState('');
  const enter = useCallback(async () => {
    setGate('loading');
    try {
      setViewer(await marketApi<Viewer>('?action=viewer'));
    } catch (e) {
      const failure = e as MarketApiError;
      setGateError(failure.message);
      setGate(failure.status === 401 ? 'guest' : 'error');
    }
  }, []);
  useEffect(() => void enter(), [enter]);
  const onBalance = useCallback(
    (balance: number) =>
      setViewer((old) =>
        old && old.balance !== balance ? { ...old, balance } : old,
      ),
    [],
  );
  const view = params.get('view') === 'assets' ? 'assets' : 'catalog',
    lotKind = params.get('lot'),
    lotKey = params.get('key') || '',
    tabParam = params.get('tab'),
    tab = isKind(tabParam) ? tabParam : 'username';
  const inLot = isKind(lotKind) && !!lotKey;
  const restriction = viewer?.me.restriction,
    readOnly = !!restriction;
  const search = (
    <>
      <Search size={18} />
      <input
        type="search"
        placeholder="Имя, номер или подарок"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          if (inLot || view !== 'catalog') go({ tab: inLot ? lotKind : tab });
        }}
      />
    </>
  );
  return (
    <div className="mk-root">
      <header className="mk-hdr">
        <MarketLink to={{}} go={go} className="mk-logo" label="Noctgram Маркет">
          <NoctLogo size={28} />
          <span className="mk-wordmark">noctgram</span>
          <span className="mk-mk">Маркет</span>
        </MarketLink>
        <nav className="mk-nav" aria-label="Разделы">
          <MarketLink
            to={{}}
            go={go}
            className={view === 'catalog' ? 'on' : ''}
          >
            Каталог
          </MarketLink>
          <MarketLink
            to={{ view: 'assets' }}
            go={go}
            className={view === 'assets' && !inLot ? 'on' : ''}
          >
            Мои активы
          </MarketLink>
        </nav>
        <label className="mk-search">{search}</label>
        {viewer && (
          <div className="mk-hdr-side">
            <a
              className="mk-balance"
              href="/?page=stars"
              aria-label={`Баланс ${num(viewer.balance)} Stars`}
            >
              <StarsIcon size={16} />
              {num(viewer.balance)}
            </a>
            <a href="/" aria-label="Вернуться в Noctgram">
              <Avatar person={viewer.me} size={36} />
            </a>
          </div>
        )}
      </header>
      {!viewer ? (
        <main className="mk-wrap">
          {gate === 'loading' ? (
            <div className="mk-card mk-hero" aria-busy="true">
              <span className="mk-sk" style={{ width: 160, height: 28 }} />
              <span className="mk-sk" style={{ width: '70%' }} />
            </div>
          ) : gate === 'guest' ? (
            <div className="mk-card mk-empty">
              <Lock size={40} strokeWidth={1.4} />
              <h1 className="mk-h2">Войдите в Noctgram</h1>
              <p className="mk-meta">
                Каталог, покупки и ваши активы доступны после входа.
              </p>
              <a className="mk-btn mk-btn-pri" href="/login">
                Войти
              </a>
            </div>
          ) : (
            <Failure text={gateError} retry={() => void enter()} />
          )}
        </main>
      ) : (
        <>
          {restriction && (
            <div className="mk-wrap" style={{ paddingBottom: 0 }}>
              <output className="mk-banner">
                <Lock size={18} />
                <span>
                  Аккаунт в режиме «
                  {restriction.mode === 'blocked'
                    ? 'заблокирован'
                    : 'только чтение'}
                  ». Торговля недоступна
                  {restriction.reason ? ': ' + restriction.reason : '.'}
                </span>
              </output>
            </div>
          )}
          {inLot ? (
            <Lot
              key={lotKind + lotKey}
              kind={lotKind}
              lotKey={lotKey}
              go={go}
              viewer={viewer}
              readOnly={readOnly}
              onBalance={onBalance}
            />
          ) : view === 'assets' ? (
            <Assets go={go} readOnly={readOnly} onBalance={onBalance} />
          ) : (
            <Catalog
              key={tab}
              tab={tab}
              go={go}
              query={query}
              setQuery={setQuery}
            />
          )}
        </>
      )}
      <nav className="mk-bnav" aria-label="Навигация">
        <MarketLink
          to={{}}
          go={go}
          className={view === 'catalog' || inLot ? 'on' : ''}
        >
          <LayoutGrid size={22} />
          Каталог
        </MarketLink>
        <MarketLink
          to={{ view: 'assets' }}
          go={go}
          className={view === 'assets' && !inLot ? 'on' : ''}
        >
          <Briefcase size={22} />
          Мои активы
        </MarketLink>
        <a href="/?page=stars">
          <Wallet size={22} />
          Stars
        </a>
        <a href="/">
          <House size={22} />
          Noctgram
        </a>
      </nav>
    </div>
  );
}
