'use client';
/* eslint-disable react/react-compiler */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, LoaderCircle } from 'lucide-react';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { giftDefinition, type ReceivedGift } from '@/lib/gift-catalog';
import type {
  GiftConversionPreview,
  GiftConversionResult,
} from '@/lib/gift-conversion-policy';
import { GiftAnimation } from './gift-animation';
import { StarsIcon } from './stars-icon';

export type GiftConversionUpdate = {
  id: string;
  amount: number;
  created: number;
};

async function request<T>(url: string, body?: object): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok || !data)
    throw new Error(
      data?.error || 'Не удалось получить ответ. Попробуй ещё раз.',
    );
  return data;
}

export function GiftConversionPanel({
  receipt,
  onConverted,
  onBack,
}: {
  receipt: ReceivedGift;
  onConverted: (conversion: GiftConversionUpdate) => void;
  onBack: () => void;
}) {
  const [preview, setPreview] = useState<GiftConversionPreview | null>(null);
  const [result, setResult] = useState<GiftConversionUpdate | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [reload, setReload] = useState(0);
  const alive = useRef(true);
  const locked = useRef(false);
  const announced = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const update = useRef(onConverted);
  update.current = onConverted;
  const definition = giftDefinition(receipt.giftId);

  function complete(conversion: GiftConversionUpdate, nextBalance?: number) {
    if (alive.current) {
      setResult(conversion);
      setUncertain(false);
      setError('');
      if (nextBalance !== undefined) setBalance(nextBalance);
      update.current(conversion);
    }
    if (!announced.current) {
      announced.current = true;
      // The wallet and chat already subscribe to this shared gift refresh event.
      window.dispatchEvent(
        new CustomEvent('noctgram:gifts-changed', { detail: { conversion } }),
      );
    }
  }

  useEffect(() => {
    alive.current = true;
    title.current?.focus({ preventScroll: true });
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void request<GiftConversionPreview>(
      '/api/gifts?action=convert&id=' + encodeURIComponent(receipt.id),
    )
      .then((data) => {
        if (!active) return;
        setPreview(data);
        setUncertain(false);
        if (data.convertedAt !== null)
          complete({
            id: receipt.id,
            amount: data.amount,
            created: data.convertedAt,
          });
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // Callback updates are held in a ref; a quote is fetched only on entry/retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.id, reload]);

  const canConfirm = !!preview?.available && !loading && !uncertain && !error;

  async function convert() {
    if (!preview || !canConfirm || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const data = await request<GiftConversionResult>('/api/gifts', {
        action: 'convert',
        id: receipt.id,
        expectedAmount: preview.amount,
      });
      complete(
        { id: data.id, amount: data.amount, created: data.convertedAt },
        data.balance,
      );
    } catch (e) {
      if (alive.current) {
        setError((e as Error).message);
        setUncertain(true);
      }
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div className="gift-conversion-panel" aria-busy={loading || busy}>
      {!result && (
        <button
          type="button"
          className="gift-upgrade-back gift-conversion-back"
          aria-label="Назад к подарку"
          disabled={busy}
          onClick={onBack}
        >
          <ArrowLeft size={20} />
        </button>
      )}
      <div className="gift-conversion-heading">
        <div className="gift-conversion-art" aria-hidden="true">
          <GiftAnimation id={receipt.giftId} />
          {result && (
            <span className="gift-conversion-check">
              <Check size={20} />
            </span>
          )}
        </div>
        <DialogTitle ref={title} tabIndex={-1}>
          {result ? 'Подарок продан' : 'Продать подарок'}
        </DialogTitle>
        <DialogDescription>{definition?.name || 'Подарок'}</DialogDescription>
      </div>
      <div className="gift-conversion-body">
        {result ? (
          <>
            <output className="gift-conversion-credit" aria-live="polite">
              <span>Зачислено на твой баланс</span>
              <strong>
                +{result.amount.toLocaleString('ru-RU')} <StarsIcon size={28} />
              </strong>
            </output>
            <p className="gift-conversion-note">
              Подарок удалён из профиля. Вернуть его нельзя.
            </p>
            {balance !== null && (
              <p className="gift-conversion-balance">
                Баланс: {balance.toLocaleString('ru-RU')}{' '}
                <StarsIcon size={15} />
              </p>
            )}
            <button
              type="button"
              className="primary gift-conversion-submit"
              onClick={onBack}
            >
              Готово
            </button>
          </>
        ) : (
          <>
            {loading ? (
              <output className="gift-conversion-loading">
                <LoaderCircle className="spin" size={22} />
                Проверяем условия продажи…
              </output>
            ) : (
              preview && (
                <>
                  <dl className="gift-conversion-summary">
                    <div>
                      <dt>Стоимость подарка</dt>
                      <dd>
                        {preview.originalPrice.toLocaleString('ru-RU')}{' '}
                        <StarsIcon size={15} />
                      </dd>
                    </div>
                    <div>
                      <dt>
                        Комиссия {preview.feePercent.toLocaleString('ru-RU')}%
                      </dt>
                      <dd>
                        −{preview.fee.toLocaleString('ru-RU')}{' '}
                        <StarsIcon size={15} />
                      </dd>
                    </div>
                    <div className="gift-conversion-net">
                      <dt>Ты получишь</dt>
                      <dd>
                        {preview.amount.toLocaleString('ru-RU')}{' '}
                        <StarsIcon size={20} />
                      </dd>
                    </div>
                  </dl>
                  <p className="gift-conversion-rounding">
                    Зачисление округляется вниз до целых Noct Stars. Комиссия
                    указана с учётом округления.
                  </p>
                  {!preview.available ? (
                    <output className="gift-conversion-unavailable">
                      {preview.reason || 'Продажа этого подарка недоступна.'}
                    </output>
                  ) : (
                    <p className="gift-conversion-warning">
                      Продажа необратима. Подарок исчезнет из профиля, и его
                      больше нельзя будет улучшить или вернуть.
                    </p>
                  )}
                </>
              )
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {uncertain && (
              <p className="gift-conversion-note">
                Результат продажи пока неизвестен. Проверь его перед повторным
                подтверждением.
              </p>
            )}
            {error || uncertain ? (
              <button
                type="button"
                className="secondary gift-conversion-submit"
                disabled={loading}
                onClick={() => setReload((value) => value + 1)}
              >
                {loading ? <LoaderCircle className="spin" size={17} /> : null}
                {uncertain ? 'Проверить продажу' : 'Повторить'}
              </button>
            ) : (
              <button
                type="button"
                className="primary gift-conversion-submit"
                disabled={!canConfirm || busy}
                onClick={() => void convert()}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <StarsIcon size={19} />
                )}
                {busy
                  ? 'Продаём…'
                  : !preview
                    ? 'Продать за звёзды'
                    : preview.available
                      ? `Продать за ${preview.amount.toLocaleString('ru-RU')}`
                      : 'Продажа недоступна'}
              </button>
            )}
            <button
              type="button"
              className="gift-conversion-cancel"
              disabled={busy}
              onClick={onBack}
            >
              Оставить подарок
            </button>
          </>
        )}
      </div>
    </div>
  );
}
