'use client';
/* eslint-disable react/react-compiler */
import { useEffect, useId, useRef, useState } from 'react';
import { Gift, History, ShieldCheck } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { request } from '@/lib/client';
import { readApiJson } from '@/lib/http-response';
import type { GiftUpgradeCollection } from '@/lib/gift-collectibles';
import { StaffSelect } from './staff-select';
import { GiftCollectibleArt } from './gift-collectible-art';

type Draft = {
  action: 'adminGiftGrant';
  target: string;
  requestId: string;
  giftId: string;
  modelId: string;
  backdropId: string;
  symbolId: string;
  count: number;
  startNumber: number | null;
  keepOriginal: boolean;
  message: string;
  reason: string;
};
type Result = {
  ok: boolean;
  firstNumber: number;
  lastNumber: number;
  count: number;
};
type Catalog = {
  gifts: { id: string; name: string }[];
  collection: GiftUpgradeCollection;
  nextNumber: number;
};
const numbers = (first: number, last: number) =>
  first === last ? `#${first}` : `#${first}–#${last}`;

export function AdminGiftForm({
  target,
  handle,
  onLock,
  onIssued,
}: {
  target: string;
  handle: string;
  onLock: (locked: boolean) => void;
  onIssued: () => void;
}) {
  const [giftId, setGiftId] = useState('plush_pepe');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [modelId, setModelId] = useState(''),
    [backdropId, setBackdropId] = useState(''),
    [symbolId, setSymbolId] = useState('');
  const [count, setCount] = useState('1'),
    [start, setStart] = useState('');
  const [keepOriginal, setKeepOriginal] = useState(false),
    [message, setMessage] = useState(''),
    [reason, setReason] = useState('');
  const [pending, setPending] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [version, setVersion] = useState(0),
    [loading, setLoading] = useState(true);
  const lock = useRef(false),
    pendingRef = useRef<Draft | null>(null);
  const storageKey = 'noctgram:pending-admin-gifts:' + target;
  const originalId = useId();
  useEffect(() => {
    // Keep the same issuance ID after a lost response, even if the dialog closes.
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(storageKey) || 'null',
      ) as Draft | null;
      if (
        saved?.target === target &&
        saved.action === 'adminGiftGrant' &&
        saved.requestId
      ) {
        pendingRef.current = saved;
        setPending(saved);
        setGiftId(saved.giftId);
        setModelId(saved.modelId);
        setBackdropId(saved.backdropId);
        setSymbolId(saved.symbolId);
        setCount(String(saved.count));
        setStart(saved.startNumber === null ? '' : String(saved.startNumber));
        setKeepOriginal(saved.keepOriginal);
        setMessage(saved.message);
        setReason(saved.reason);
      }
    } catch {
      /* Storage may be unavailable. In-memory retries still use the same ID. */
    }
  }, [storageKey, target]);
  useEffect(() => {
    onLock(!!pending || busy);
    return () => onLock(false);
  }, [pending, busy, onLock]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    void request<Catalog>(
      '?action=adminGiftCatalog&giftId=' + encodeURIComponent(giftId),
    )
      .then((data) => {
        if (!live) return;
        setCatalog(data);
        setModelId((old) =>
          data.collection.models.some((a) => a.id === old)
            ? old
            : data.collection.models[0].id,
        );
        setBackdropId((old) =>
          data.collection.backdrops.some((a) => a.id === old)
            ? old
            : data.collection.backdrops[0].id,
        );
        setSymbolId((old) =>
          data.collection.symbols.some((a) => a.id === old)
            ? old
            : data.collection.symbols[0].id,
        );
        setError('');
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [giftId, version]);
  const collection =
    catalog?.collection.id === giftId ? catalog.collection : null;
  const model = collection?.models.find((a) => a.id === modelId),
    backdrop = collection?.backdrops.find((a) => a.id === backdropId),
    symbol = collection?.symbols.find((a) => a.id === symbolId);
  const first = start ? Number(start) : catalog?.nextNumber || 1;
  const quantity = Number(count),
    last = first + quantity - 1;
  const valid =
    !!model &&
    !!backdrop &&
    !!symbol &&
    Number.isSafeInteger(first) &&
    first > 0 &&
    last <= 1_000_000_000 &&
    Number.isSafeInteger(quantity) &&
    quantity >= 1 &&
    quantity <= 10 &&
    !!reason.trim();
  async function submit() {
    if (lock.current || (!pendingRef.current && (!valid || loading))) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const draft: Draft = pendingRef.current || {
      action: 'adminGiftGrant',
      target,
      requestId: crypto.randomUUID(),
      giftId,
      modelId,
      backdropId,
      symbolId,
      count: quantity,
      startNumber: start ? Number(start) : null,
      keepOriginal,
      message: message.trim(),
      reason: reason.trim(),
    };
    pendingRef.current = draft;
    setPending(draft);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      /* See above. */
    }
    let definitive = false;
    try {
      const response = await fetch('/api/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      // Validation/collision rejects the whole batch. Authentication, throttling
      // and uncertain failures retain the ID: an earlier attempt may have succeeded.
      definitive = [400, 409, 422].includes(response.status);
      const data = await readApiJson<Result>(
        response,
        'Не удалось выдать подарки.',
      );
      if (!response.ok)
        throw new Error(data.error || 'Не удалось выдать подарки.');
      if (
        data.ok !== true ||
        !Number.isSafeInteger(data.firstNumber) ||
        !Number.isSafeInteger(data.lastNumber)
      )
        throw new Error(
          'Результат выдачи ещё не подтверждён. Проверьте его повторно.',
        );
      definitive = true;
      setNotice(
        `Выдано @${handle}: ${data.count} шт., ${numbers(data.firstNumber, data.lastNumber)}.`,
      );
      setVersion((v) => v + 1);
      window.dispatchEvent(new Event('noctgram:gifts-changed'));
      onIssued();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (definitive) {
        pendingRef.current = null;
        setPending(null);
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* Optional persistence. */
        }
      }
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="admin-gift-form">
      <fieldset disabled={!!pending || busy}>
        {catalog && (
          <StaffSelect
            label="Коллекция"
            value={giftId}
            options={catalog.gifts.map((g) => ({ value: g.id, label: g.name }))}
            disabled={!!pending || busy}
            onChange={(id) => {
              setGiftId(id);
              setNotice('');
            }}
          />
        )}
        {loading && (
          <output className="admin-gift-note">Загружаем варианты…</output>
        )}
        {collection && model && backdrop && symbol && (
          <>
            <div className="admin-gift-preview">
              <GiftCollectibleArt
                family={giftId}
                attributes={{ model, backdrop, symbol }}
              >
                <div className="gift-collectible-heading">
                  <strong>
                    {catalog?.gifts.find((g) => g.id === giftId)?.name}
                  </strong>
                  <span>
                    {valid || !reason ? numbers(first, last) : 'Предпросмотр'}
                  </span>
                </div>
              </GiftCollectibleArt>
              <div className="admin-gift-preview-copy">
                <span className="staff-status">
                  <ShieldCheck size={13} /> Выдача администратора
                </span>
                <p>Готовый коллекционный подарок с выбранными атрибутами.</p>
                <small>
                  Stars не списываются. Атрибуты после выдачи не меняются.
                </small>
              </div>
            </div>
            <div className="staff-field-grid">
              <StaffSelect
                label="Модель"
                value={modelId}
                options={collection.models.map((a) => ({
                  value: a.id,
                  label: a.name,
                }))}
                onChange={setModelId}
                disabled={!!pending || busy}
              />
              <StaffSelect
                label="Фон"
                value={backdropId}
                options={collection.backdrops.map((a) => ({
                  value: a.id,
                  label: a.name,
                }))}
                onChange={setBackdropId}
                disabled={!!pending || busy}
              />
              <StaffSelect
                label="Узор"
                value={symbolId}
                options={collection.symbols.map((a) => ({
                  value: a.id,
                  label: a.name,
                }))}
                onChange={setSymbolId}
                disabled={!!pending || busy}
              />
              <label className="account-field">
                Количество
                <input
                  type="number"
                  min={1}
                  max={10}
                  step={1}
                  required
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                />
              </label>
            </div>
            <label className="account-field">
              Первый номер
              <input
                type="number"
                min={1}
                max={1_000_000_000 - quantity + 1}
                step={1}
                placeholder={`Автоматически, следующий — #${catalog?.nextNumber}`}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <p className="admin-gift-note">
              Оставьте пустым для автоматической нумерации. Номер уникален
              внутри коллекции: занятые номера нельзя повторить или заменить.
              Если занят хотя бы один номер серии, ничего не будет выдано.
            </p>
            <label className="admin-gift-checkbox" htmlFor={originalId}>
              <Checkbox
                id={originalId}
                checked={keepOriginal}
                onCheckedChange={(checked) => setKeepOriginal(checked === true)}
                disabled={!!pending || busy}
              />
              <span>Показывать отправителя и подпись в подарке</span>
            </label>
            {keepOriginal && (
              <label className="account-field">
                Подпись получателю
                <textarea
                  rows={2}
                  maxLength={240}
                  value={message}
                  placeholder="Например, для команды разработчиков"
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>
            )}
            <label className="account-field">
              <span className="staff-field-caption">
                Причина для журнала <small>{reason.length}/500</small>
              </span>
              <textarea
                required
                rows={2}
                maxLength={500}
                placeholder="Например, награда за разработку Noctgram"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </>
        )}
      </fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="moderation-notice">{notice}</output>}
      {pending && !busy && (
        <output className="admin-gift-note">
          Сначала проверим предыдущую выдачу. Повторный запрос с тем же ID не
          создаст ещё одну серию.
        </output>
      )}
      {!collection && !loading && !pending && (
        <button
          type="button"
          className="secondary"
          onClick={() => setVersion((v) => v + 1)}
        >
          Загрузить варианты
        </button>
      )}
      <div className="staff-form-footer">
        <span>
          <History size={14} /> Сохраним номера и атрибуты в журнале
        </span>
        <button
          type="button"
          className="primary"
          disabled={busy || (!pending && (!valid || loading))}
          onClick={() => void submit()}
        >
          <Gift size={17} />
          {busy
            ? 'Проверяем выдачу…'
            : pending
              ? 'Проверить выдачу'
              : `Выдать ${quantity || 1} шт.`}
        </button>
      </div>
    </div>
  );
}
