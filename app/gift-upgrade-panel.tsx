'use client';
/* eslint-disable react/react-compiler */
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  Check,
  Gem,
  Hash,
  LoaderCircle,
  Palette,
  Sparkles,
} from 'lucide-react';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { giftDefinition, type ReceivedGift } from '@/lib/gift-catalog';
import {
  giftRarity,
  type GiftAttributes,
  type GiftCollectible,
  type GiftUpgradeCollection,
  type GiftUpgradePreview,
} from '@/lib/gift-collectibles';
import { GiftCollectibleArt } from './gift-collectible-art';
import { StarsIcon } from './stars-icon';

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
  if (!response.ok)
    throw new Error(
      data?.error || 'Не удалось улучшить подарок. Попробуй ещё раз.',
    );
  if (!data)
    throw new Error(
      'Не удалось получить результат. Проверь улучшение ещё раз.',
    );
  return data as T;
}
function previewAttributes(
  collection: GiftUpgradeCollection,
  step: number,
): GiftAttributes {
  return {
    model: collection.models[(step * 7) % collection.models.length],
    backdrop: collection.backdrops[(step * 3) % collection.backdrops.length],
    symbol: collection.symbols[(step * 13) % collection.symbols.length],
  };
}
export function GiftAttributeTable({
  attributes,
  phase = 3,
}: {
  attributes: GiftAttributes;
  phase?: number;
}) {
  return (
    <dl className="gift-attribute-table" aria-hidden={phase < 3 || undefined}>
      {(
        [
          ['Модель', attributes.model, 2],
          ['Фон', attributes.backdrop, 0],
          ['Узор', attributes.symbol, 1],
        ] as const
      ).map(([label, value, settledAfter]) => (
        <div key={label} data-settled={phase > settledAfter}>
          <dt>{label}</dt>
          <dd>
            <span className="gift-attribute-slot">
              <strong key={value.id}>{value.name}</strong>
            </span>
            <span className="gift-rarity">
              {giftRarity(value.rarityPermille)}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function GiftUpgradePanel({
  receipt,
  onUpdated,
  onBack,
}: {
  receipt: ReceivedGift;
  onUpdated: (collectible: GiftCollectible) => void;
  onBack: () => void;
}) {
  const [preview, setPreview] = useState<GiftUpgradePreview | null>(null);
  const originalId = useId();
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<GiftCollectible | null>(null);
  const [phase, setPhase] = useState(-1);
  const [celebrate, setCelebrate] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const alive = useRef(true);
  const locked = useRef(false);
  const reduced = useRef(false);
  const revealTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const update = useRef(onUpdated);
  update.current = onUpdated;
  const title = giftDefinition(receipt.giftId)?.name || 'Подарок';

  useEffect(() => {
    alive.current = true;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => {
      reduced.current = motion.matches;
      if (motion.matches) {
        if (revealTimer.current) clearInterval(revealTimer.current);
        setPhase((p) => (p >= 0 ? 3 : p));
        setCelebrate(false);
      }
    };
    changed();
    motion.addEventListener('change', changed);
    return () => {
      alive.current = false;
      motion.removeEventListener('change', changed);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setError('');
    void request<GiftUpgradePreview>(
      '/api/gifts?action=upgrade&id=' + encodeURIComponent(receipt.id),
    )
      .then((data) => {
        if (!active) return;
        setPreview(data);
        if (data.collectible) {
          setResult(data.collectible);
          setPhase(3);
          update.current(data.collectible);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [receipt.id, reload]);
  useEffect(() => {
    if (!preview?.collection || result) return;
    const interval = setInterval(() => {
      if (!document.hidden && !reduced.current && !locked.current)
        setStep((value) => value + 1);
    }, 3000);
    return () => clearInterval(interval);
  }, [preview, result]);
  useEffect(() => {
    if (!result || phase < 0 || phase === 3) return;
    const start = performance.now();
    // Native sequence: backdrop, symbol, model; confetti after the final settle.
    const tick = setInterval(() => {
      const elapsed = performance.now() - start;
      setStep((value) => value + 1);
      setPhase(elapsed < 550 ? 0 : elapsed < 1100 ? 1 : elapsed < 1650 ? 2 : 3);
      if (elapsed >= 1650) clearInterval(tick);
    }, 100);
    revealTimer.current = tick;
    return () => clearInterval(tick);
    // The reveal clock starts once per successful receipt, not at each phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  useEffect(() => {
    if (!result || phase !== 3 || !celebrate) return;
    const timer = setTimeout(() => setCelebrate(false), 4000);
    return () => clearTimeout(timer);
  }, [result, phase, celebrate]);

  async function upgrade() {
    if (!preview?.collection || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      if (uncertain) {
        // Recover the committed result before offering another explicit purchase.
        // A stale price must be shown and confirmed again, never retried silently.
        const current = await request<GiftUpgradePreview>(
          '/api/gifts?action=upgrade&id=' + encodeURIComponent(receipt.id),
        );
        if (!alive.current) return;
        setPreview(current);
        setUncertain(false);
        if (current.collectible) {
          setResult(current.collectible);
          setPhase(3);
          setCelebrate(false);
          update.current(current.collectible);
          window.dispatchEvent(new Event('noctgram:gifts-changed'));
        }
        return;
      }
      const data = await request<{
        collectible: GiftCollectible;
        balance: number;
      }>('/api/gifts', {
        action: 'upgrade',
        id: receipt.id,
        keepOriginal,
        expectedPrice: preview.collection.price,
      });
      if (!alive.current) return;
      setPreview((old) => old && { ...old, balance: data.balance });
      setResult(data.collectible);
      setPhase(reduced.current ? 3 : 0);
      setCelebrate(!reduced.current);
      setUncertain(false);
      update.current(data.collectible);
      window.dispatchEvent(new Event('noctgram:gifts-changed'));
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
  if (!preview || (!preview.collection && !preview.collectible))
    return (
      <div className="gift-upgrade-loading">
        <DialogTitle>Улучшение подарка</DialogTitle>
        <DialogDescription>
          {preview
            ? 'Для этого подарка коллекционная версия пока недоступна.'
            : 'Загружаем варианты…'}
        </DialogDescription>
        {!preview && !error && <LoaderCircle className="spin" size={25} />}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {error && (
          <button
            className="secondary"
            onClick={() => setReload((value) => value + 1)}
          >
            Повторить
          </button>
        )}
        <button className="secondary" onClick={onBack}>
          Назад
        </button>
      </div>
    );

  const variations = preview.collection
    ? previewAttributes(preview.collection, step)
    : result!;
  const displayed = result
    ? {
        backdrop: phase >= 1 ? result.backdrop : variations.backdrop,
        symbol: phase >= 2 ? result.symbol : variations.symbol,
        model: phase >= 3 ? result.model : variations.model,
      }
    : variations;
  const rolling = !!result && phase < 3;
  return (
    <div className="gift-upgrade-panel" data-revealing={rolling}>
      {!result && (
        <button
          className="gift-upgrade-back"
          onClick={onBack}
          disabled={busy}
          aria-label="Назад к подарку"
        >
          <ArrowLeft size={20} />
        </button>
      )}
      <GiftCollectibleArt
        family={receipt.giftId}
        attributes={displayed}
        animate={!rolling && !busy}
      >
        <div className="gift-collectible-heading">
          <DialogTitle>{result ? title : 'Улучшить подарок'}</DialogTitle>
          <DialogDescription>
            {result
              ? `Коллекционный подарок #${result.number.toLocaleString('ru-RU')}`
              : title}
          </DialogDescription>
        </div>
      </GiftCollectibleArt>
      <div className="gift-upgrade-body">
        {result ? (
          <>
            <GiftAttributeTable attributes={displayed} phase={phase} />
            <output className="gift-upgrade-success">
              {rolling ? (
                'Раскрываем атрибуты…'
              ) : (
                <>
                  <Check size={16} /> Подарок улучшен
                </>
              )}
            </output>
            <button
              className="primary gift-upgrade-submit"
              onClick={() => {
                if (rolling) {
                  if (revealTimer.current) clearInterval(revealTimer.current);
                  setPhase(3);
                } else onBack();
              }}
            >
              {rolling ? 'Пропустить' : 'Готово'}
            </button>
          </>
        ) : (
          <>
            <p className="gift-upgrade-intro">
              Преврати подарок в уникальный коллекционный экземпляр.
            </p>
            <ul className="gift-upgrade-benefits">
              <li>
                <Palette size={23} />
                <div>
                  <strong>Уникальный вид</strong>
                  <p>
                    Одна из {preview.collection!.models.length} моделей с новым
                    фоном и узором.
                  </p>
                </div>
              </li>
              <li>
                <Gem size={23} />
                <div>
                  <strong>Редкие атрибуты</strong>
                  <p>Сочетание определяется случайно при улучшении.</p>
                </div>
              </li>
              <li>
                <Hash size={23} />
                <div>
                  <strong>Коллекционный номер</strong>
                  <p>Твой экземпляр получит собственный номер в Noctgram.</p>
                </div>
              </li>
            </ul>
            <label className="gift-upgrade-original" htmlFor={originalId}>
              <Checkbox
                id={originalId}
                checked={keepOriginal}
                onCheckedChange={(value) => setKeepOriginal(!!value)}
                disabled={busy || uncertain}
              />
              <span>Сохранить имя отправителя и подпись</span>
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button
              className="primary gift-upgrade-submit"
              disabled={
                busy ||
                (!uncertain && preview.balance < preview.collection!.price)
              }
              onClick={() => void upgrade()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Sparkles size={17} />
              )}
              {busy
                ? 'Улучшаем…'
                : uncertain
                  ? 'Проверить улучшение'
                  : 'Улучшить за'}
              {!busy && !uncertain && (
                <>
                  <StarsIcon size={17} />
                  {preview.collection!.price.toLocaleString('ru-RU')}
                </>
              )}
            </button>
            <p className="gift-upgrade-balance">
              {preview.balance < preview.collection!.price
                ? 'Не хватает Noct Stars. '
                : ''}
              Баланс: {preview.balance.toLocaleString('ru-RU')}{' '}
              <StarsIcon size={13} />
            </p>
            <details className="gift-upgrade-about">
              <summary>О коллекционных подарках</summary>
              <p>
                Улучшение необратимо. Варианты в предпросмотре — примеры. После
                улучшения модель, фон, узор и номер сохраняются.
              </p>
              <p>
                Оформление подарков: Telegram. Данные и ассеты:{' '}
                <a
                  href="https://t.me/GiftChanges"
                  target="_blank"
                  rel="noreferrer"
                >
                  @GiftChanges
                </a>
                .
              </p>
            </details>
          </>
        )}
      </div>
      {phase === 3 && celebrate && (
        <div className="gift-upgrade-confetti" aria-hidden="true">
          {Array.from({ length: 32 }, (_, i) => (
            <i
              key={i}
              style={
                {
                  '--x': `${((i * 47) % 110) - 55}vw`,
                  '--r': `${i * 83}deg`,
                  '--delay': `${(i % 5) * 25}ms`,
                  '--hue': (i * 43) % 360,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
