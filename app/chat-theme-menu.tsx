'use client';
import { useState } from 'react';
import { ChatNotificationsItem } from './chat-notifications';
import {
  Check,
  EllipsisVertical,
  Palette,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CHAT_THEMES,
  chatTheme,
  type ChatThemeId,
  type ChatThemeState,
} from '@/lib/chat-themes';

export function ChatThemeMenu({
  owner,
  peer,
  value,
  canShare,
  onRefresh,
  onSave,
}: {
  owner: string;
  peer: string;
  value: ChatThemeState;
  canShare: boolean;
  onRefresh: () => void;
  onSave: (
    scope: 'personal' | 'shared',
    theme: ChatThemeId | null,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<ChatThemeId>('noct');
  const [scope, setScope] = useState<'personal' | 'shared'>('personal');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const theme = chatTheme(selected);
  const save = async (
    target: 'personal' | 'shared',
    id: ChatThemeId | null,
  ) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave(target, id);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить тему');
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          className="icon-button chat-more"
          aria-label="Меню диалога"
          title="Меню диалога"
        >
          <EllipsisVertical size={19} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="chat-options-menu">
          {menuOpen && (
            <ChatNotificationsItem
              key={owner + ':' + peer}
              owner={owner}
              peer={peer}
            />
          )}
          <DropdownMenuItem
            onClick={() => {
              setSelected(value.personal || value.shared);
              setScope('personal');
              setError('');
              setOpen(true);
            }}
          >
            <Palette size={17} /> Оформление чата
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onRefresh}>
            <RefreshCw size={17} /> Обновить сообщения
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!saving) setOpen(next);
        }}
      >
        <DialogContent
          className="noct-dialog chat-theme-dialog"
          overlayClassName="chat-theme-overlay"
        >
          <div className="chat-theme-heading">
            <DialogTitle>Оформление чата</DialogTitle>
            <DialogDescription>
              Твой цвет для ваших разговоров.
            </DialogDescription>
          </div>
          <div className="chat-theme-preview" style={theme.style}>
            <span className="chat-theme-preview-label">{theme.name}</span>
            <div className="chat-theme-sample incoming">
              Останешься ещё немного?<small>00:24</small>
            </div>
            <div className="chat-theme-sample outgoing">
              С тобой — да.
              <small>
                00:24 <Check size={12} />
              </small>
            </div>
          </div>
          <fieldset className="chat-theme-grid">
            <legend className="sr-only">Темы диалога</legend>
            {CHAT_THEMES.map((item) => (
              <button
                type="button"
                key={item.id}
                className="chat-theme-choice"
                aria-pressed={selected === item.id}
                disabled={saving}
                onClick={() => setSelected(item.id)}
              >
                <span
                  className="chat-theme-swatch"
                  style={item.style}
                  aria-hidden="true"
                >
                  <i />
                  <i />
                  {selected === item.id && (
                    <span className="chat-theme-check">
                      <Check size={12} />
                    </span>
                  )}
                </span>
                <span>{item.name}</span>
              </button>
            ))}
          </fieldset>
          <fieldset className="chat-theme-audience">
            <legend className="sr-only">Кому показать тему</legend>
            <button
              type="button"
              aria-pressed={scope === 'personal'}
              disabled={saving}
              onClick={() => setScope('personal')}
            >
              Только у меня
            </button>
            <button
              type="button"
              aria-pressed={scope === 'shared'}
              disabled={saving || !canShare}
              onClick={() => setScope('shared')}
            >
              Для обоих
            </button>
          </fieldset>
          <p className="chat-theme-hint">
            {scope === 'shared'
              ? 'Личная тема собеседника останется, если он выбрал её отдельно.'
              : 'Собеседник продолжит видеть свою тему.'}
          </p>
          {value.personal !== null && (
            <button
              type="button"
              className="chat-theme-reset"
              disabled={saving}
              onClick={() => void save('personal', null)}
            >
              <RotateCcw size={14} /> Вернуть общую тему ·{' '}
              {chatTheme(value.shared).name}
            </button>
          )}
          {error && (
            <p role="alert" className="chat-theme-error">
              {error}
            </p>
          )}
          <button
            type="button"
            className="chat-theme-apply"
            disabled={saving || (scope === 'shared' && !canShare)}
            onClick={() => void save(scope, selected)}
          >
            {saving ? 'Сохраняем…' : 'Применить тему'}
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
