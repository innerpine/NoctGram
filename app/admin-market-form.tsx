'use client';
import { useRef, useState } from 'react';
import { Check, History } from 'lucide-react';
import { marketApi } from '@/lib/market-policy';
import { StaffSelect } from './staff-select';

const kinds = [
  { value: 'number', label: 'Анонимные номера' },
  { value: 'username', label: 'Юзернеймы' },
];
export function AdminMarketForm({ onIssued }: { onIssued: () => void }) {
  const [kind, setKind] = useState('number'),
    [lots, setLots] = useState(''),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  // The same request id is reused until the form changes, so a retry cannot issue twice.
  const pending = useRef<{ body: string; id: string } | null>(null);
  const submit = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    const body = { action: 'issue', kind, lots, reason: reason.trim() };
    const fingerprint = JSON.stringify(body);
    if (pending.current?.body !== fingerprint)
      pending.current = { body: fingerprint, id: crypto.randomUUID() };
    try {
      const result = await marketApi<{
        created: string[];
        repriced: string[];
        skipped: string[];
      }>('', { ...body, requestId: pending.current.id });
      pending.current = null;
      setNotice(
        `Выпущено лотов: ${result.created.length}.` +
          (result.repriced.length
            ? ` Новая цена: ${result.repriced.join(', ')}.`
            : '') +
          (result.skipped.length
            ? ` Без изменений (заняты, проданы или цена та же): ${result.skipped.join(', ')}.`
            : ''),
      );
      if (!result.skipped.length) setLots('');
      onIssued();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="admin-grant-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={busy}>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && <output className="moderation-notice">{notice}</output>}
        <StaffSelect
          label="Тип лотов"
          value={kind}
          options={kinds}
          disabled={busy}
          onChange={setKind}
        />
        <label className="account-field">
          <span className="staff-field-caption">
            Лоты: по одному в строке, значение и цена в Stars через пробел.
            Чтобы изменить цену лота, который уже продаёт Маркет, введите его
            ещё раз с новой ценой.
          </span>
          <textarea
            required
            rows={5}
            maxLength={4000}
            value={lots}
            onChange={(e) => setLots(e.target.value)}
            placeholder={
              kind === 'number'
                ? '+888 1234 5678 36000\n77777777 250000'
                : 'noir 48000\nluna 32000'
            }
          />
        </label>
        <label className="account-field">
          <span className="staff-field-caption">
            Причина <small>{reason.length}/500</small>
          </span>
          <textarea
            required
            maxLength={500}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Например, первый выпуск красивых номеров"
          />
        </label>
        <div className="staff-form-footer">
          <span>
            <History size={14} /> Сохраним в журнале
          </span>
          <button
            className="primary"
            disabled={!lots.trim() || !reason.trim() || busy}
          >
            <Check size={16} />
            {busy ? 'Выпускаем…' : 'Выпустить в Маркет'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
