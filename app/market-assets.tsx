'use client';
/* eslint-disable react/react-compiler */
import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { PackageOpen } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  MARKET_FEE_PERCENT,
  MARKET_MAX_PRICE,
  marketApi,
  marketFee,
  type MarketAsset,
  type MarketAssets,
  type MarketGift,
  type MarketKind,
} from '@/lib/market-policy';
import { GiftCollectibleArt } from './gift-collectible-art';
import { StarsIcon } from './stars-icon';

export type Go = (params: Record<string, string>) => void;
export const num = (value: number) => value.toLocaleString('ru-RU');
export const marketHref = (params: Record<string, string>) => {
  const query = new URLSearchParams(params).toString();
  return '/market' + (query ? '?' + query : '');
};
export const kindLabels: Record<MarketKind, string> = {
  username: 'Юзернеймы',
  number: 'Номера',
  gift: 'Подарки',
};
export const kindOrder: MarketKind[] = ['username', 'number', 'gift'];

export function MarketLink({
  to,
  go,
  className,
  children,
  label,
  style,
}: {
  to: Record<string, string>;
  go: Go;
  className?: string;
  children: ReactNode;
  label?: string;
  style?: CSSProperties;
}) {
  return (
    <a
      href={marketHref(to)}
      className={className}
      style={style}
      aria-label={label}
      onClick={(event: MouseEvent) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        go(to);
      }}
    >
      {children}
    </a>
  );
}
export function Stars({
  value,
  large,
  dim,
}: {
  value: number;
  large?: boolean;
  dim?: boolean;
}) {
  return (
    <span
      className={
        'mk-stars' + (large ? ' mk-stars-lg' : '') + (dim ? ' mk-dim' : '')
      }
    >
      <StarsIcon size={large ? 24 : 16} />
      {num(value)}
    </span>
  );
}
export function GiftArt({
  gift,
  size,
}: {
  gift: MarketGift;
  size?: 'sm' | 'lg';
}) {
  return (
    <div className={'mk-art' + (size ? ' mk-art-' + size : '')}>
      <GiftCollectibleArt
        family={gift.family}
        attributes={gift.attributes}
        animate={size === 'lg'}
      />
    </div>
  );
}

export type SellTarget = Pick<MarketAsset, 'kind' | 'key' | 'title' | 'gift'>;
function SellForm({
  asset,
  onClose,
  onDone,
}: {
  asset: SellTarget;
  onClose: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const price = Number(value.replace(/\D/g, '')) || 0,
    fee = marketFee(price),
    valid = price >= 1 && price <= MARKET_MAX_PRICE;
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await marketApi('', {
        action: 'list',
        kind: asset.kind,
        key: asset.key,
        price,
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <form
      className="mk-dlg-body"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) void submit();
      }}
    >
      <DialogTitle>Выставить на продажу</DialogTitle>
      <div className="mk-asset">
        {asset.gift && <GiftArt gift={asset.gift} size="sm" />}
        <div>
          <div className="mk-med">{asset.title}</div>
          <DialogDescription>
            {asset.kind === 'username'
              ? 'Юзернейм'
              : asset.kind === 'number'
                ? 'Анонимный номер'
                : 'Коллекционный подарок'}{' '}
            · фиксированная цена
          </DialogDescription>
        </div>
      </div>
      <label className="mk-field">
        Цена
        <span className="mk-input">
          <StarsIcon size={16} />
          <input
            inputMode="numeric"
            autoComplete="off"
            placeholder="0"
            value={price ? num(price) : ''}
            onChange={(event) => setValue(event.target.value)}
          />
          Stars
        </span>
      </label>
      <div className="mk-card">
        <div className="mk-kv">
          <span>Цена</span>
          <Stars value={price} />
        </div>
        <div className="mk-kv">
          <span>Комиссия Маркета · {MARKET_FEE_PERCENT}%</span>
          <span className="mk-num">−{num(fee)}</span>
        </div>
        <div className="mk-kv">
          <span>Вы получите</span>
          <Stars value={price - fee} />
        </div>
      </div>
      <p className="mk-meta">
        Актив остаётся вашим до продажи. Снять его с продажи можно в любой
        момент.
      </p>
      {error && (
        <p className="mk-banner mk-error" role="alert">
          {error}
        </p>
      )}
      <div className="mk-dlg-actions">
        <button type="button" className="mk-btn mk-btn-sec" onClick={onClose}>
          Отмена
        </button>
        <button className="mk-btn mk-btn-pri" disabled={!valid || busy}>
          {busy ? 'Выставляем…' : 'Выставить на продажу'}
        </button>
      </div>
    </form>
  );
}
export function SellDialog({
  asset,
  onClose,
  onDone,
}: {
  asset: SellTarget | null;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <Dialog open={!!asset} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="noct-dialog mk-dlg">
        {asset && (
          <SellForm
            key={asset.kind + asset.key}
            asset={asset}
            onClose={onClose}
            onDone={onDone}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function Assets({
  go,
  readOnly,
  onBalance,
}: {
  go: Go;
  readOnly: boolean;
  onBalance: (balance: number) => void;
}) {
  const [data, setData] = useState<MarketAssets | null>(null),
    [tab, setTab] = useState<MarketKind>('username'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(''),
    [selling, setSelling] = useState<SellTarget | null>(null);
  const load = useCallback(async () => {
    try {
      const next = await marketApi<MarketAssets>('?action=assets');
      setData(next);
      setError('');
      onBalance(next.balance);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [onBalance]);
  useEffect(() => void load(), [load]);
  const act = async (id: string, body: object) => {
    setBusy(id);
    try {
      await marketApi('', body);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const all = data?.assets || [],
    rows = all.filter((asset) => asset.kind === tab);
  const lotOf = (asset: MarketAsset) => ({ lot: asset.kind, key: asset.key });
  return (
    <main className="mk-wrap">
      <div className="mk-rise">
        <h1 className="mk-h1">Мои активы</h1>
        <p className="mk-meta">
          Всё, что можно выставить в Маркете: дополнительные юзернеймы,
          анонимные номера и коллекционные подарки.
        </p>
      </div>
      <div
        className="mk-utabs mk-rise"
        role="tablist"
        style={{ '--i': 1 } as object}
      >
        {kindOrder.map((kind) => (
          <button
            key={kind}
            role="tab"
            aria-selected={tab === kind}
            className={tab === kind ? 'on' : ''}
            onClick={() => setTab(kind)}
          >
            {kindLabels[kind]}{' '}
            <span className="mk-meta mk-num">
              {all.filter((asset) => asset.kind === kind).length}
            </span>
          </button>
        ))}
      </div>
      {error && (
        <p className="mk-banner mk-error" role="alert">
          {error}
        </p>
      )}
      {!data && !error ? (
        <div className="mk-card-flat">
          {[0, 1, 2].map((i) => (
            <div className="mk-row mk-row-assets" key={i}>
              <span className="mk-sk" style={{ width: '60%' }} />
              <span className="mk-sk" style={{ width: '50%' }} />
              <span className="mk-sk mk-r" style={{ width: 70 }} />
              <span className="mk-sk" style={{ width: 120 }} />
            </div>
          ))}
        </div>
      ) : rows.length ? (
        <div className="mk-card-flat mk-rise" style={{ '--i': 2 } as object}>
          <div className="mk-row mk-row-assets mk-row-head">
            <span>Актив</span>
            <span>Статус</span>
            <span className="mk-r">Цена</span>
            <span className="mk-r">Действия</span>
          </div>
          {rows.map((asset) => (
            <div className="mk-row mk-row-assets" key={asset.key}>
              <span className="mk-asset">
                {asset.gift && <GiftArt gift={asset.gift} size="sm" />}
                {/* A username has a lot page only once it has been on the market. */}
                {asset.kind === 'username' && !asset.listing ? (
                  <span className="mk-lot">{asset.title}</span>
                ) : (
                  <MarketLink to={lotOf(asset)} go={go} className="mk-lot">
                    {asset.title}
                  </MarketLink>
                )}
              </span>
              <span
                className={
                  'mk-st ' + (asset.listing ? 'mk-st-sale' : 'mk-st-profile')
                }
              >
                <i />
                {asset.listing
                  ? 'Продаётся'
                  : asset.main
                    ? 'В профиле · основной'
                    : asset.kind === 'number' && !asset.displayed
                      ? 'Скрыт из профиля'
                      : 'В профиле'}
              </span>
              <span className="mk-r">
                {asset.listing ? (
                  <Stars value={asset.listing.price} />
                ) : (
                  <span className="mk-t48">—</span>
                )}
              </span>
              <span className="mk-actions">
                {asset.listing ? (
                  <button
                    className="mk-btn mk-btn-sec mk-btn-sm"
                    disabled={readOnly || busy === asset.key}
                    onClick={() =>
                      void act(asset.key, {
                        action: 'cancel',
                        listingId: asset.listing?.id,
                      })
                    }
                  >
                    Снять с продажи
                  </button>
                ) : (
                  <button
                    className="mk-btn mk-btn-sec mk-btn-sm"
                    disabled={readOnly || asset.main}
                    title={
                      asset.main
                        ? 'Основной юзернейм нельзя продать. Сделайте основным другой.'
                        : undefined
                    }
                    onClick={() => setSelling(asset)}
                  >
                    Выставить на продажу
                  </button>
                )}
                {asset.kind === 'number' && (
                  <button
                    className="mk-btn mk-btn-ghost mk-btn-sm"
                    disabled={readOnly || busy === asset.key}
                    onClick={() =>
                      void act(asset.key, {
                        action: 'displayNumber',
                        number: asset.displayed ? null : asset.key,
                      })
                    }
                  >
                    {asset.displayed
                      ? 'Скрыть из профиля'
                      : 'Показать в профиле'}
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : (
        data && (
          <div className="mk-card mk-empty">
            <PackageOpen size={40} strokeWidth={1.4} />
            <h2 className="mk-h2">Здесь пока пусто</h2>
            <p className="mk-meta">
              {tab === 'gift'
                ? 'Улучшите подарок до коллекционного или купите его в каталоге.'
                : 'Купленные лоты появятся здесь.'}
            </p>
            <MarketLink to={{ tab }} go={go} className="mk-btn mk-btn-sec">
              Открыть каталог
            </MarketLink>
          </div>
        )
      )}
      <section className="mk-card">
        <h2 className="mk-h2">Как это работает</h2>
        <p className="mk-meta">
          Выставленный актив остаётся вашим до момента продажи. Комиссия Маркета
          — {MARKET_FEE_PERCENT}% от суммы сделки, её платит продавец. Основной
          юзернейм продать нельзя.
        </p>
      </section>
      <SellDialog
        asset={selling}
        onClose={() => setSelling(null)}
        onDone={() => {
          setSelling(null);
          void load();
        }}
      />
    </main>
  );
}
