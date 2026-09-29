'use client';
/* eslint-disable react/react-compiler */
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Flag,
  Link2,
  LoaderCircle,
  Pencil,
  Plus,
  Sticker,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  MANAGE_STICKERS,
  OPEN_STICKER_PACK,
  loadStickerPanel,
  manageStickers,
  readMyStickerPacks,
  readStickerPack,
  stickerAction,
  stickerPackLink,
  uploadSticker,
} from '@/lib/sticker-client';
import {
  EMOJI_PER_PACK,
  PACK_TITLE_LIMIT,
  STICKERS_PER_PACK,
  type StickerInfo,
  type StickerPackInfo,
} from '@/lib/sticker-types';
import { appNotice } from '@/lib/app-notice';
import { StickerView } from './sticker-view';

const reason = (error: unknown, fallback = 'Не удалось выполнить действие') =>
  error instanceof Error ? error.message : fallback;
function countLabel(pack: Pick<StickerPackInfo, 'type'>, count: number) {
  const form = new Intl.PluralRules('ru').select(count);
  if (pack.type === 'emoji') return `${count} эмодзи`;
  return `${count} ${form === 'one' ? 'стикер' : form === 'few' ? 'стикера' : 'стикеров'}`;
}
async function copyLink(shortName: string) {
  try {
    await navigator.clipboard.writeText(stickerPackLink(shortName));
    appNotice('Ссылка на набор скопирована');
  } catch {
    appNotice(stickerPackLink(shortName));
  }
}
// The panel changes after installs and edits; pickers reload it quietly.
const refreshPanel = (meId: string) =>
  void loadStickerPanel(meId, true).catch(() => {});

// Opens pack previews and «Мои наборы» from links, messages and pickers.
export function StickerPackHost({ meId }: { meId?: string }) {
  const [view, setView] = useState<
    { kind: 'pack'; name: string } | { kind: 'manage'; packId?: string } | null
  >(null);
  useEffect(() => {
    if (!meId) return;
    const linked = new URLSearchParams(window.location.search).get('stickers');
    if (linked) setView({ kind: 'pack', name: linked.slice(0, 64) });
    const open = (event: Event) => {
      const name = (event as CustomEvent<{ name?: string }>).detail?.name;
      if (name) setView({ kind: 'pack', name });
    };
    const manage = (event: Event) =>
      setView({
        kind: 'manage',
        packId: (event as CustomEvent<{ packId?: string }>).detail?.packId,
      });
    window.addEventListener(OPEN_STICKER_PACK, open);
    window.addEventListener(MANAGE_STICKERS, manage);
    return () => {
      window.removeEventListener(OPEN_STICKER_PACK, open);
      window.removeEventListener(MANAGE_STICKERS, manage);
    };
  }, [meId]);
  const close = () => {
    setView(null);
    const url = new URL(window.location.href);
    if (url.searchParams.has('stickers')) {
      url.searchParams.delete('stickers');
      history.replaceState(history.state, '', url.pathname + url.search);
    }
  };
  if (!meId || !view) return null;
  return view.kind === 'pack' ? (
    <StickerPackPreview
      key={'pack:' + view.name}
      meId={meId}
      name={view.name}
      onClose={close}
    />
  ) : (
    <StickerPackManager
      key={'manage:' + (view.packId || '')}
      meId={meId}
      packId={view.packId}
      onClose={close}
    />
  );
}

function StickerPackPreview({
  meId,
  name,
  onClose,
}: {
  meId: string;
  name: string;
  onClose: () => void;
}) {
  const [pack, setPack] = useState<StickerPackInfo | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [reporting, setReporting] = useState(false),
    [complaint, setComplaint] = useState('');
  useEffect(() => {
    let active = true;
    readStickerPack(meId, name)
      .then((value) => {
        if (active) setPack(value);
      })
      .catch((cause) => {
        if (active) setError(reason(cause, 'Набор недоступен'));
      });
    return () => {
      active = false;
    };
  }, [meId, name]);
  const run = async (body: Record<string, unknown>, done: () => void) => {
    setBusy(true);
    setError('');
    try {
      await stickerAction(meId, body);
      done();
      refreshPanel(meId);
    } catch (cause) {
      setError(reason(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="noct-dialog sticker-pack-dialog">
        <DialogTitle>{pack?.title || 'Набор стикеров'}</DialogTitle>
        <DialogDescription>
          {pack
            ? countLabel(pack, pack.stickers.length) +
              (pack.builtin ? ' · встроенный набор' : '')
            : error
              ? ''
              : 'Загружаем набор…'}
        </DialogDescription>
        {pack ? (
          <div
            className={
              'sticker-pack-grid' + (pack.type === 'emoji' ? ' emoji' : '')
            }
          >
            {pack.stickers.map((sticker) => (
              <span key={sticker.ref} className="sticker-pack-item">
                <StickerView sticker={sticker} />
              </span>
            ))}
            {!pack.stickers.length && (
              <p className="emoji-panel-note">В наборе пока нет стикеров</p>
            )}
          </div>
        ) : (
          !error && (
            <p className="emoji-panel-note">
              <LoaderCircle className="spin" size={18} />
            </p>
          )
        )}
        {error && (
          <p role="alert" className="room-error">
            {error}
          </p>
        )}
        {reporting && pack ? (
          <form
            className="sticker-report"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                { action: 'report', id: pack.id, reason: complaint },
                () => {
                  setReporting(false);
                  appNotice('Жалоба отправлена модераторам');
                },
              );
            }}
          >
            <label>
              Что нарушает правила?
              <textarea
                required
                rows={3}
                maxLength={500}
                value={complaint}
                onChange={(event) => setComplaint(event.target.value)}
              />
            </label>
            <div className="chat-operation-buttons">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setReporting(false)}
              >
                Отмена
              </button>
              <button className="danger" disabled={busy || !complaint.trim()}>
                Пожаловаться
              </button>
            </div>
          </form>
        ) : (
          pack && (
            <div className="sticker-pack-actions">
              {!pack.builtin && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void copyLink(pack.shortName)}
                >
                  <Link2 size={15} /> Ссылка
                </button>
              )}
              {pack.own && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => manageStickers(pack.id)}
                >
                  <Pencil size={15} /> Изменить
                </button>
              )}
              {!pack.builtin && !pack.own && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setReporting(true)}
                >
                  <Flag size={15} /> Пожаловаться
                </button>
              )}
              {!pack.builtin && (
                <button
                  type="button"
                  className={pack.installed ? 'secondary' : 'primary'}
                  disabled={busy}
                  onClick={() =>
                    void run(
                      {
                        action: pack.installed ? 'uninstall' : 'install',
                        ref: pack.ref,
                      },
                      () => {
                        setPack({ ...pack, installed: !pack.installed });
                        appNotice(
                          pack.installed
                            ? 'Набор убран из панели'
                            : 'Набор добавлен в панель',
                        );
                      },
                    )
                  }
                >
                  {busy && <LoaderCircle className="spin" size={15} />}
                  {pack.installed
                    ? 'Убрать из панели'
                    : pack.type === 'emoji'
                      ? `Добавить ${countLabel(pack, pack.stickers.length)}`
                      : `Добавить ${countLabel(pack, pack.stickers.length)}`}
                </button>
              )}
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

const EMOJI_CHOICES = [
  '🙂',
  '😂',
  '😍',
  '😢',
  '😡',
  '👍',
  '👋',
  '🎉',
  '❤️',
  '🔥',
];
function EmojiField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <span className="sticker-emoji-field">
      <input
        aria-label={label}
        value={value}
        maxLength={16}
        onChange={(event) => onChange(event.target.value.trim())}
      />
      {EMOJI_CHOICES.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className={value === emoji ? 'selected' : ''}
          aria-label={'Эмодзи ' + emoji}
          onClick={() => onChange(emoji)}
        >
          {emoji}
        </button>
      ))}
    </span>
  );
}

// «Мои наборы»: packs made by this account, their stickers and links.
function StickerPackManager({
  meId,
  packId,
  onClose,
}: {
  meId: string;
  packId?: string;
  onClose: () => void;
}) {
  const [packs, setPacks] = useState<StickerPackInfo[] | null>(null),
    [limit, setLimit] = useState(20),
    [editing, setEditing] = useState<string | null>(packId ?? null),
    [creating, setCreating] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const value = await readMyStickerPacks(meId);
      setPacks(value.packs);
      setLimit(value.limit);
    } catch (cause) {
      setError(reason(cause, 'Наборы недоступны'));
    }
  };
  useEffect(() => {
    void load();
    // Loads once per open; later changes reload explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId]);
  const pack = packs?.find((item) => item.id === editing) ?? null;
  const replace = (next: StickerPackInfo) =>
    setPacks((current) =>
      (current ?? []).map((item) => (item.id === next.id ? next : item)),
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="noct-dialog sticker-manager-dialog">
        <DialogTitle>
          {creating ? 'Новый набор' : pack ? pack.title : 'Мои наборы'}
        </DialogTitle>
        <DialogDescription>
          {creating
            ? 'Стикеры отправляются отдельными сообщениями, эмодзи вставляются в текст.'
            : pack
              ? countLabel(pack, pack.stickers.length) +
                ' · до ' +
                (pack.type === 'emoji' ? EMOJI_PER_PACK : STICKERS_PER_PACK)
              : `Наборы стикеров и эмодзи, которые вы создали. До ${limit} наборов.`}
        </DialogDescription>
        {error && (
          <p role="alert" className="room-error">
            {error}
          </p>
        )}
        {creating ? (
          <CreatePack
            meId={meId}
            busy={busy}
            setBusy={setBusy}
            onCancel={() => setCreating(false)}
            onCreated={(created) => {
              setCreating(false);
              setPacks((current) => [created, ...(current ?? [])]);
              setEditing(created.id);
              refreshPanel(meId);
            }}
          />
        ) : pack ? (
          <PackEditor
            key={pack.id}
            meId={meId}
            pack={pack}
            busy={busy}
            setBusy={setBusy}
            onChange={(next) => {
              replace(next);
              refreshPanel(meId);
            }}
            onDeleted={() => {
              setPacks((current) =>
                (current ?? []).filter((item) => item.id !== pack.id),
              );
              setEditing(null);
              refreshPanel(meId);
            }}
            onBack={() => setEditing(null)}
          />
        ) : (
          <div className="sticker-manager-list">
            {packs?.map((item) => (
              <button
                key={item.id}
                type="button"
                className="sticker-manager-row"
                onClick={() => setEditing(item.id)}
              >
                <span className="sticker-manager-cover">
                  {item.stickers[0] ? (
                    <StickerView sticker={item.stickers[0]} animate={false} />
                  ) : (
                    <Sticker size={22} />
                  )}
                </span>
                <span className="sticker-manager-copy">
                  <strong>{item.title}</strong>
                  <small>
                    {item.removed
                      ? 'Удалён модератором'
                      : countLabel(item, item.stickers.length) +
                        ' · ' +
                        (item.type === 'emoji' ? 'эмодзи' : 'стикеры')}
                  </small>
                </span>
              </button>
            ))}
            {packs && !packs.length && (
              <p className="emoji-panel-note">
                У вас пока нет своих наборов. Создайте первый — из картинок
                WebP, PNG или анимаций TGS.
              </p>
            )}
            {!packs && !error && (
              <p className="emoji-panel-note">
                <LoaderCircle className="spin" size={18} />
              </p>
            )}
            <div className="chat-operation-buttons">
              <button type="button" className="secondary" onClick={onClose}>
                Закрыть
              </button>
              <button
                type="button"
                className="primary"
                disabled={!packs || packs.length >= limit}
                onClick={() => {
                  setError('');
                  setCreating(true);
                }}
              >
                <Plus size={16} /> Создать набор
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreatePack({
  meId,
  busy,
  setBusy,
  onCancel,
  onCreated,
}: {
  meId: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onCancel: () => void;
  onCreated: (pack: StickerPackInfo) => void;
}) {
  const [title, setTitle] = useState(''),
    [shortName, setShortName] = useState(''),
    [type, setType] = useState<'stickers' | 'emoji'>('stickers'),
    [error, setError] = useState('');
  return (
    <form
      className="sticker-create"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
          onCreated(
            await stickerAction<StickerPackInfo>(meId, {
              action: 'createPack',
              title,
              shortName,
              type,
            }),
          );
        } catch (cause) {
          setError(reason(cause));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Название
        <input
          required
          maxLength={PACK_TITLE_LIMIT}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        Короткое имя для ссылки
        <input
          required
          minLength={5}
          maxLength={32}
          pattern="[a-z0-9_]{5,32}"
          value={shortName}
          onChange={(event) =>
            setShortName(event.target.value.toLowerCase().replace(/\s/g, '_'))
          }
        />
        <small>
          Латиница, цифры и «_». Ссылка: /?stickers={shortName || 'имя'}
        </small>
      </label>
      <fieldset className="sticker-type">
        <legend>Тип набора</legend>
        {(
          [
            ['stickers', 'Стикеры', 'До 120 штук, отдельные сообщения'],
            ['emoji', 'Эмодзи', 'До 200 штук, вставляются в текст'],
          ] as const
        ).map(([value, label, hint]) => (
          <label
            key={value}
            className={type === value ? 'selected' : ''}
            aria-label={label}
          >
            <input
              type="radio"
              name="sticker-pack-type"
              checked={type === value}
              onChange={() => setType(value)}
            />
            <span>
              <strong>{label}</strong>
              <small>{hint}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {error && (
        <p role="alert" className="room-error">
          {error}
        </p>
      )}
      <div className="chat-operation-buttons">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Назад
        </button>
        <button className="primary" disabled={busy || !title.trim()}>
          {busy && <LoaderCircle className="spin" size={16} />}
          Создать
        </button>
      </div>
    </form>
  );
}

type Upload = { id: string; name: string; error?: string };
function PackEditor({
  meId,
  pack,
  busy,
  setBusy,
  onChange,
  onDeleted,
  onBack,
}: {
  meId: string;
  pack: StickerPackInfo;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onChange: (pack: StickerPackInfo) => void;
  onDeleted: () => void;
  onBack: () => void;
}) {
  const [title, setTitle] = useState(pack.title),
    [emoji, setEmoji] = useState('🙂'),
    [uploads, setUploads] = useState<Upload[]>([]),
    [confirming, setConfirming] = useState(false),
    [editingEmoji, setEditingEmoji] = useState<string | null>(null),
    [emojiDraft, setEmojiDraft] = useState(''),
    [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(pack);
  latest.current = pack;
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (cause) {
      setError(reason(cause));
    } finally {
      setBusy(false);
    }
  };
  const add = async (files: File[]) => {
    const queued = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      file,
    }));
    setUploads((current) => [
      ...current,
      ...queued.map(({ id, name }) => ({ id, name })),
    ]);
    setBusy(true);
    for (const item of queued) {
      try {
        const sticker = await uploadSticker(meId, pack.id, emoji, item.file);
        latest.current = {
          ...latest.current,
          stickers: [...latest.current.stickers, sticker],
        };
        onChange(latest.current);
        setUploads((current) => current.filter((row) => row.id !== item.id));
      } catch (cause) {
        setUploads((current) =>
          current.map((row) =>
            row.id === item.id
              ? { ...row, error: reason(cause, 'Не удалось загрузить') }
              : row,
          ),
        );
      }
    }
    setBusy(false);
  };
  const move = (sticker: StickerInfo, step: number) =>
    run(async () => {
      const list = [...pack.stickers];
      const from = list.findIndex((item) => item.ref === sticker.ref),
        to = from + step;
      if (from < 0 || to < 0 || to >= list.length) return;
      [list[from], list[to]] = [list[to], list[from]];
      await stickerAction(meId, {
        action: 'reorder',
        id: pack.id,
        ids: list.map((item) => item.ref.slice(2)),
      });
      onChange({ ...pack, stickers: list });
    });
  if (pack.removed)
    return (
      <div className="sticker-editor">
        <p className="account-note">
          Набор удалён модератором за нарушение правил. Его стикеры больше
          никому не показываются.
        </p>
        <div className="chat-operation-buttons">
          <button type="button" className="secondary" onClick={onBack}>
            <ArrowLeft size={15} /> Назад
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await stickerAction(meId, {
                  action: 'deletePack',
                  id: pack.id,
                });
                onDeleted();
              })
            }
          >
            Убрать из списка
          </button>
        </div>
      </div>
    );
  return (
    <div className="sticker-editor">
      <form
        className="sticker-title-row"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const next = await stickerAction<StickerPackInfo>(meId, {
              action: 'updatePack',
              id: pack.id,
              title,
            });
            onChange({ ...pack, title: next.title });
          });
        }}
      >
        <input
          aria-label="Название набора"
          maxLength={PACK_TITLE_LIMIT}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button
          className="secondary"
          disabled={busy || !title.trim() || title.trim() === pack.title}
        >
          Сохранить
        </button>
      </form>
      <div className="sticker-link-row">
        <code>/?stickers={pack.shortName}</code>
        <button
          type="button"
          className="icon-button"
          aria-label="Скопировать ссылку на набор"
          onClick={() => void copyLink(pack.shortName)}
        >
          <Link2 size={16} />
        </button>
      </div>
      <div className="sticker-upload">
        <span>
          Эмодзи для новых {pack.type === 'emoji' ? 'эмодзи' : 'стикеров'}
        </span>
        <EmojiField
          value={emoji}
          onChange={setEmoji}
          label="Эмодзи для новых стикеров"
        />
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept="image/png,image/webp,.tgs,application/x-tgsticker"
          onChange={(event) => {
            const files = Array.from(event.target.files || []);
            event.target.value = '';
            if (files.length) void add(files);
          }}
        />
        <button
          type="button"
          className="primary"
          disabled={busy || !emoji}
          onClick={() => input.current?.click()}
        >
          <Upload size={15} /> Добавить файлы
        </button>
        <small>
          {pack.type === 'emoji'
            ? 'PNG или WebP до 128 КБ и 512×512, либо TGS до 64 КБ.'
            : 'PNG или WebP до 512 КБ и 512×512, либо TGS 512×512 до 64 КБ и 3 секунд.'}
        </small>
      </div>
      {uploads.map((item) => (
        <p
          key={item.id}
          className={'sticker-upload-row' + (item.error ? ' failed' : '')}
        >
          {!item.error && <LoaderCircle className="spin" size={14} />}
          <span>{item.name}</span>
          {item.error && <small>{item.error}</small>}
          {item.error && (
            <button
              type="button"
              className="icon-button"
              aria-label={'Скрыть ошибку ' + item.name}
              onClick={() =>
                setUploads((current) =>
                  current.filter((row) => row.id !== item.id),
                )
              }
            >
              ×
            </button>
          )}
        </p>
      ))}
      <div
        className={
          'sticker-editor-grid' + (pack.type === 'emoji' ? ' emoji' : '')
        }
      >
        {pack.stickers.map((sticker, index) => (
          <div key={sticker.ref} className="sticker-editor-item">
            <StickerView sticker={sticker} />
            {editingEmoji === sticker.ref ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await stickerAction(meId, {
                      action: 'updateSticker',
                      id: sticker.ref.slice(2),
                      emoji: emojiDraft,
                    });
                    onChange({
                      ...pack,
                      stickers: pack.stickers.map((item) =>
                        item.ref === sticker.ref
                          ? { ...item, emoji: emojiDraft }
                          : item,
                      ),
                    });
                    setEditingEmoji(null);
                  });
                }}
              >
                <input
                  aria-label="Эмодзи стикера"
                  value={emojiDraft}
                  maxLength={16}
                  onChange={(event) => setEmojiDraft(event.target.value.trim())}
                />
                <button className="secondary" disabled={busy || !emojiDraft}>
                  OK
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="sticker-editor-emoji"
                aria-label={'Изменить эмодзи стикера ' + sticker.emoji}
                onClick={() => {
                  setEditingEmoji(sticker.ref);
                  setEmojiDraft(sticker.emoji);
                }}
              >
                {sticker.emoji}
              </button>
            )}
            <span className="sticker-editor-tools">
              <button
                type="button"
                className="icon-button"
                aria-label="Сдвинуть влево"
                disabled={busy || index === 0}
                onClick={() => void move(sticker, -1)}
              >
                <ArrowLeft size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Сдвинуть вправо"
                disabled={busy || index === pack.stickers.length - 1}
                onClick={() => void move(sticker, 1)}
              >
                <ArrowRight size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={'Удалить стикер ' + sticker.emoji}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await stickerAction(meId, {
                      action: 'removeSticker',
                      id: sticker.ref.slice(2),
                    });
                    onChange({
                      ...pack,
                      stickers: pack.stickers.filter(
                        (item) => item.ref !== sticker.ref,
                      ),
                    });
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            </span>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="room-error">
          {error}
        </p>
      )}
      {confirming ? (
        <div className="sticker-confirm">
          <p>
            Удалить набор «{pack.title}»? Отправленные стикеры из него станут
            недоступны у всех.
          </p>
          <div className="chat-operation-buttons">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Отмена
            </button>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await stickerAction(meId, {
                    action: 'deletePack',
                    id: pack.id,
                  });
                  onDeleted();
                })
              }
            >
              Удалить набор
            </button>
          </div>
        </div>
      ) : (
        <div className="chat-operation-buttons">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onBack}
          >
            <ArrowLeft size={15} /> Все наборы
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            <Trash2 size={15} /> Удалить набор
          </button>
        </div>
      )}
    </div>
  );
}
