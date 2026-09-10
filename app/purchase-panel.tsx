'use client';
/* eslint-disable react/react-compiler */
import { useEffect, useId, useRef, useState } from 'react';
import {
  Check,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { readApiJson } from '@/lib/http-response';
import catalog from '@/lib/commerce-catalog.json';
import { StarsIcon } from './stars-icon';
import { PremiumIcon } from './premium-icon';

type Order = {
  id: string;
  status: string;
  checkoutUrl: string | null;
  product: string;
  units: number;
  amountMinor: number;
  currency: string;
};
export function PurchaseButton({
  owner,
  product,
  onPaid,
}: {
  owner: string;
  product: 'stars' | 'premium';
  onPaid: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="primary purchase-open" onClick={() => setOpen(true)}>
        {product === 'stars' ? (
          <StarsIcon size={20} />
        ) : (
          <PremiumIcon size={20} />
        )}{' '}
        {product === 'stars'
          ? 'Пополнить Stars'
          : 'Premium · 149 ₽ / 650 Telegram Stars'}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="purchase-dialog">
          <DialogTitle>
            {product === 'stars'
              ? 'Пополнить Noct Stars'
              : 'Noct Premium на 30 дней'}
          </DialogTitle>
          <DialogDescription>
            {product === 'stars'
              ? 'Выбери пакет для подарков и поддержки авторов.'
              : 'Оформление профиля, анимированные аватары и Premium-эмодзи. Без автопродления.'}
          </DialogDescription>
          {open && (
            <PurchaseForm
              key={owner + product}
              owner={owner}
              product={product}
              onPaid={onPaid}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function PurchaseForm({
  owner,
  product,
  onPaid,
}: {
  owner: string;
  product: 'stars' | 'premium';
  onPaid: () => void;
}) {
  const [sku, setSku] = useState(
      product === 'premium' ? 'premium30' : 'stars1000',
    ),
    [provider, setProvider] = useState<'telegram' | 'crypto'>('telegram'),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [order, setOrder] = useState<Order | null>(null),
    [available, setAvailable] = useState<{
      telegram: boolean;
      crypto: boolean;
    } | null>(null);
  const agreementId = useId();
  const requestKey = useRef(crypto.randomUUID()),
    alive = useRef(true),
    checking = useRef(false),
    notified = useRef(false),
    paidRef = useRef(onPaid);
  paidRef.current = onPaid;
  const api = async (query: string, body?: unknown) => {
    const r = await fetch('/api/payments' + query, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    const data = await readApiJson<
      Order & { telegram: boolean; crypto: boolean }
    >(r, 'Не удалось проверить оплату');
    if (!r.ok) throw new Error(data.error || 'Не удалось проверить оплату');
    return data;
  };
  useEffect(() => {
    alive.current = true;
    void api('?actor=' + encodeURIComponent(owner))
      .then((v) => {
        if (alive.current) setAvailable(v);
      })
      .catch((e) => {
        if (alive.current) setError(e.message);
      });
    return () => {
      alive.current = false;
    };
  }, [owner]);
  const check = async () => {
    if (!order || checking.current) return;
    checking.current = true;
    try {
      const next = await api(
        '?id=' + order.id + '&actor=' + encodeURIComponent(owner),
      );
      if (alive.current) {
        setOrder(next);
        setError('');
        if (next.status === 'paid' && !notified.current) {
          notified.current = true;
          paidRef.current();
        }
      }
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : 'Проверка недоступна');
    } finally {
      checking.current = false;
    }
  };
  useEffect(() => {
    if (!order || order.status !== 'pending') return;
    const timer = setInterval(() => {
      if (!document.hidden) void check();
    }, 6000);
    return () => clearInterval(timer);
  });
  const item = catalog.find((p) => p.id === sku)!;
  const change = () => {
    requestKey.current = crypto.randomUUID();
    setOrder(null);
    setError('');
  };
  return (
    <div className="purchase-form">
      {!order && (
        <>
          {product === 'stars' && (
            <div className="purchase-packages">
              {catalog
                .filter((p) => p.product === 'stars')
                .map((p) => (
                  <button
                    key={p.id}
                    className={sku === p.id ? 'selected' : ''}
                    onClick={() => {
                      setSku(p.id);
                      change();
                    }}
                    disabled={busy}
                  >
                    <span>
                      <StarsIcon size={18} />
                      {p.units.toLocaleString('ru-RU')}
                    </span>
                    <small>
                      {provider === 'telegram'
                        ? p.xtr + ' TG Stars'
                        : p.rub + ' ₽'}
                    </small>
                  </button>
                ))}
            </div>
          )}
          <fieldset className="purchase-methods" aria-label="Способ оплаты">
            {(['telegram', 'crypto'] as const).map((p) => (
              <button
                key={p}
                className={provider === p ? 'selected' : ''}
                disabled={busy || !available?.[p]}
                onClick={() => {
                  setProvider(p);
                  change();
                }}
              >
                {p === 'telegram' ? (
                  <StarsIcon size={21} />
                ) : (
                  <Wallet size={21} />
                )}
                <span>
                  <strong>
                    {p === 'telegram' ? 'Telegram Stars' : 'Crypto Pay'}
                  </strong>
                  <small>
                    {p === 'telegram'
                      ? item.xtr + ' Stars'
                      : item.rub + ' ₽ · USDT / TON'}
                  </small>
                </span>
                {provider === p && <Check size={16} />}
              </button>
            ))}
          </fieldset>
          <p className="purchase-terms">
            {product === 'premium'
              ? 'Доступ на 30 дней. Продление добавляет 30 дней к текущему сроку.'
              : 'Noct Stars — внутренняя валюта NoctGram.'}{' '}
            Начислим после подтверждения оплаты. Помощь и возврат: команда
            /paysupport в боте NoctGram.
          </p>
          <label className="purchase-agreement" htmlFor={agreementId}>
            <Checkbox
              id={agreementId}
              checked={accepted}
              onCheckedChange={(v) => setAccepted(v === true)}
              disabled={busy}
            />
            <span>Согласен с условиями покупки и указанной ценой</span>
          </label>
          <button
            className="primary"
            disabled={busy || !accepted || !available?.[provider]}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const next = await api('', {
                  actor: owner,
                  sku,
                  provider,
                  key: requestKey.current,
                  acceptedTerms: true,
                });
                if (alive.current) setOrder(next);
              } catch (e) {
                if (alive.current)
                  setError(
                    e instanceof Error ? e.message : 'Не удалось создать счёт',
                  );
              } finally {
                if (alive.current) setBusy(false);
              }
            }}
          >
            {busy ? (
              <>
                <LoaderCircle className="spin" size={17} />
                Готовим счёт…
              </>
            ) : (
              `Перейти к оплате · ${provider === 'telegram' ? item.xtr + ' Stars' : item.rub + ' ₽'}`
            )}
          </button>
        </>
      )}
      {order && (
        <div
          className={
            'purchase-receipt ' + (order.status === 'paid' ? 'paid' : '')
          }
        >
          {order.status === 'paid' ? (
            <>
              <span className="purchase-check">
                <Check size={26} />
              </span>
              <h3>
                {product === 'premium'
                  ? 'Premium активирован'
                  : 'Stars на твоём балансе'}
              </h3>
              <p>Спасибо за поддержку NoctGram.</p>
            </>
          ) : (
            <>
              <h3>
                {(
                  {
                    pending: 'Счёт готов',
                    expired: 'Срок счёта истёк',
                    refunded: 'Возврат учтён',
                    review: 'Платёж проверяется',
                  } as Record<string, string>
                )[order.status] || 'Ожидаем оплату'}
              </h3>
              <p>
                {order.status === 'pending'
                  ? 'Открой счёт и подтверди оплату. Статус обновится автоматически.'
                  : 'Если нужна помощь, отправь номер заказа через /paysupport в боте.'}
              </p>
              {order.status === 'pending' && order.checkoutUrl && (
                <a
                  className="primary"
                  href={order.checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Открыть счёт <ExternalLink size={16} />
                </a>
              )}
              <button className="secondary" onClick={() => void check()}>
                <RefreshCw size={16} />
                Проверить оплату
              </button>
            </>
          )}
          <small className="purchase-order-id">Заказ {order.id}</small>
          {['expired', 'refunded'].includes(order.status) && (
            <button className="text-button" onClick={change}>
              Новая покупка
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
