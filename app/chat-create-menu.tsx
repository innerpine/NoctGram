'use client';

import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import {
  ArrowRight,
  Check,
  Globe2,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Search,
  ShieldCheck,
  Smartphone,
  Users,
  X,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Input } from '@/components/ui/input';
import { Avatar, DisplayName } from './profile-identity';

export type RoomPerson = {
  id: string;
  name: string;
  avatar?: string;
  handle?: string;
  kind?: string;
};

export type CreateGroupInput = {
  name: string;
  description: string;
  visibility: 'private' | 'public';
  username: string;
  memberIds: string[];
};

export type RoomPeopleProps = {
  people: RoomPerson[];
  ownerId: string;
  peopleLoading?: boolean;
  peopleError?: string;
  /** When provided, the owner performs search and supplies its results in people. */
  onQueryChange?: (query: string) => void;
  onRetryPeople?: () => void;
};

type ControlledRoomDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ChatCreateMenu({
  onCreateGroup,
  onCreateSecret,
  disabled = false,
}: {
  onCreateGroup: () => void;
  onCreateSecret: () => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="icon-button room-create-trigger"
        aria-label="Создать чат или группу"
        title="Создать чат или группу"
        disabled={disabled}
      >
        <Plus size={19} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={9}
        className="room-create-menu"
      >
        <DropdownMenuItem onClick={onCreateSecret} className="room-create-item">
          <span className="room-menu-symbol room-menu-secret">
            <LockKeyhole size={18} aria-hidden="true" />
          </span>
          <span className="room-menu-copy">
            <strong>Секретный чат</strong>
            <small>Со сквозным шифрованием</small>
          </span>
          <ArrowRight
            size={14}
            className="room-menu-arrow"
            aria-hidden="true"
          />
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCreateGroup} className="room-create-item">
          <span className="room-menu-symbol">
            <Users size={18} aria-hidden="true" />
          </span>
          <span className="room-menu-copy">
            <strong>Новая группа</strong>
            <small>Групповой чат</small>
          </span>
          <ArrowRight
            size={14}
            className="room-menu-arrow"
            aria-hidden="true"
          />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useRoomSubmit(
  onOpenChange: ControlledRoomDialogProps['onOpenChange'],
) {
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const submit = async (operation: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
      if (alive.current) onOpenChange(false);
    } catch (cause) {
      if (alive.current) {
        const status = Number((cause as { status?: number }).status);
        const ambiguous = !status || status >= 500;
        setUncertain(ambiguous);
        setError(
          ambiguous
            ? 'Не получено подтверждение. Повтори попытку: проверим создание этого же чата, без копий.'
            : cause instanceof Error
              ? cause.message
              : 'Не удалось создать чат. Попробуй ещё раз.',
        );
      }
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return {
    busy,
    locked: busy || uncertain,
    error,
    setError: (message: string) => {
      setError(message);
      if (!message) setUncertain(false);
    },
    submit,
    changeOpen: (next: boolean) => {
      if (!pending.current) onOpenChange(next);
    },
  };
}

function eligiblePeople(people: RoomPerson[], ownerId: string, query: string) {
  const seen = new Set<string>();
  const search = query.trim().replace(/^@/, '').toLocaleLowerCase('ru');
  return people.filter((person) => {
    if (
      person.id === ownerId ||
      person.id === 'noctgram' ||
      (person.kind && person.kind !== 'person') ||
      seen.has(person.id)
    )
      return false;
    seen.add(person.id);
    return (
      !search ||
      person.name.toLocaleLowerCase('ru').includes(search) ||
      person.handle?.toLocaleLowerCase('ru').includes(search)
    );
  });
}

function PeopleSearch({
  id,
  query,
  onChange,
  disabled,
}: {
  id: string;
  query: string;
  onChange: (query: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="room-people-search" htmlFor={id}>
      <Search size={17} aria-hidden="true" />
      <Input
        id={id}
        type="search"
        aria-label="Поиск по имени или нику"
        placeholder="Имя или @ник"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        autoComplete="off"
      />
    </label>
  );
}

function PeopleStatus({
  loading,
  error,
  empty,
  query,
  onRetry,
}: {
  loading?: boolean;
  error?: string;
  empty: boolean;
  query: string;
  onRetry?: () => void;
}) {
  if (error)
    return (
      <div className="room-people-status room-error" role="alert">
        <span>{error}</span>
        {onRetry && (
          <button type="button" onClick={onRetry}>
            Повторить
          </button>
        )}
      </div>
    );
  if (loading)
    return (
      <output className="room-people-status">
        <LoaderCircle size={17} className="room-spinner" aria-hidden="true" />
        Ищем людей…
      </output>
    );
  return empty ? (
    <output className="room-people-status">
      {query.trim()
        ? 'Никого не нашли. Попробуй другой ник.'
        : 'Найди человека по имени или @нику.'}
    </output>
  ) : null;
}

function PersonCopy({ person }: { person: RoomPerson }) {
  return (
    <span className="room-person-copy">
      <strong>
        <DisplayName person={person} />
      </strong>
      {person.handle && <small>@{person.handle.replace(/^@/, '')}</small>}
    </span>
  );
}

/** Keep this component mounted while open changes so the portal can finish its exit. */
export function CreateGroupDialog({
  open,
  onOpenChange,
  people,
  ownerId,
  peopleLoading,
  peopleError,
  onQueryChange,
  onRetryPeople,
  onSubmit,
}: ControlledRoomDialogProps &
  RoomPeopleProps & {
    onSubmit: (input: CreateGroupInput) => Promise<void>;
  }) {
  const id = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [username, setUsername] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<RoomPerson[]>([]);
  const mutation = useRoomSubmit(onOpenChange);
  const candidates = eligiblePeople(
    people,
    ownerId,
    onQueryChange ? '' : query,
  );
  const members = selected.filter((person) => person.id !== ownerId);
  const memberIds = new Set(members.map((person) => person.id));
  const atLimit = members.length >= 199;
  const changeQuery = (next: string) => {
    setQuery(next);
    onQueryChange?.(next);
  };
  const reset = () => {
    setName('');
    setDescription('');
    setVisibility('private');
    setUsername('');
    setSelected([]);
    changeQuery('');
    mutation.setError('');
  };
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const handle = username.trim().replace(/^@/, '').toLowerCase();
    if (!name.trim()) {
      mutation.setError('Добавь название группы.');
      return;
    }
    if (visibility === 'public' && !/^[a-z][a-z0-9_]{3,23}$/.test(handle)) {
      mutation.setError(
        'Ник: 4–24 латинских символа, цифры и _, первый символ — буква.',
      );
      return;
    }
    void mutation.submit(() =>
      onSubmit({
        name: name.trim(),
        description: description.trim(),
        visibility,
        username: visibility === 'public' ? handle : '',
        memberIds: [...memberIds].slice(0, 199),
      }),
    );
  };
  return (
    <Dialog
      open={open}
      onOpenChange={mutation.changeOpen}
      onOpenChangeComplete={(next) => {
        if (!next) reset();
      }}
    >
      <DialogContent
        className="noct-dialog room-create-dialog"
        overlayClassName="room-dialog-overlay"
        showCloseButton={false}
      >
        <button
          type="button"
          className="room-dialog-close"
          aria-label="Закрыть создание группы"
          disabled={mutation.busy}
          onClick={() => mutation.changeOpen(false)}
        >
          <X size={18} aria-hidden="true" />
        </button>
        <div className="room-dialog-heading">
          <span className="room-heading-symbol">
            <Users size={23} aria-hidden="true" />
          </span>
          <div>
            <DialogTitle>Новая группа</DialogTitle>
            <DialogDescription>
              Выберите участников группы.
            </DialogDescription>
          </div>
        </div>
        <form
          className="room-create-form"
          onSubmit={submit}
          aria-busy={mutation.busy}
        >
          <div className="room-field">
            <label htmlFor={`${id}-name`}>Название группы</label>
            <Input
              id={`${id}-name`}
              className="room-input"
              placeholder="Название группы"
              value={name}
              maxLength={100}
              disabled={mutation.locked}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="room-field">
            <label htmlFor={`${id}-description`}>
              Описание <span>необязательно</span>
            </label>
            <textarea
              id={`${id}-description`}
              className="room-input room-description-input"
              placeholder="О чём будете говорить?"
              rows={2}
              value={description}
              maxLength={500}
              disabled={mutation.locked}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <fieldset className="room-visibility" disabled={mutation.locked}>
            <legend>Доступ к группе</legend>
            <div className="room-visibility-options">
              {(['private', 'public'] as const).map((value) => (
                <label
                  key={value}
                  className="room-visibility-option"
                  data-selected={visibility === value}
                >
                  <input
                    type="radio"
                    name={`${id}-visibility`}
                    value={value}
                    checked={visibility === value}
                    onChange={() => setVisibility(value)}
                  />
                  {value === 'private' ? (
                    <LockKeyhole size={17} aria-hidden="true" />
                  ) : (
                    <Globe2 size={17} aria-hidden="true" />
                  )}
                  <span>{value === 'private' ? 'Закрытая' : 'Публичная'}</span>
                  {visibility === value && (
                    <Check
                      size={14}
                      className="room-visibility-check"
                      aria-hidden="true"
                    />
                  )}
                </label>
              ))}
            </div>
          </fieldset>
          {visibility === 'public' ? (
            <div className="room-field">
              <label htmlFor={`${id}-username`}>Публичный ник</label>
              <div className="room-username-input">
                <span aria-hidden="true">@</span>
                <Input
                  id={`${id}-username`}
                  placeholder="after_midnight"
                  value={username}
                  maxLength={25}
                  disabled={mutation.locked}
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  aria-describedby={`${id}-visibility-note`}
                  onChange={(event) =>
                    setUsername(event.target.value.replace(/^@/, ''))
                  }
                />
              </div>
              <p id={`${id}-visibility-note`} className="room-note">
                Группу можно найти по нику. 4–24 символа: латиница, цифры и _,
                начиная с буквы.
              </p>
            </div>
          ) : (
            <p className="room-note room-invite-note">
              <Link2 size={16} aria-hidden="true" />
              Ссылка-приглашение появится после создания.
            </p>
          )}
          <div className="room-members-section">
            <div className="room-section-heading">
              <h3>
                Участники <span>необязательно</span>
              </h3>
              <span className="room-member-count" aria-live="polite">
                {members.length} / 199
              </span>
            </div>
            <PeopleSearch
              id={`${id}-search`}
              query={query}
              onChange={changeQuery}
              disabled={mutation.locked}
            />
            {members.length > 0 && (
              <ul
                className="room-selected-members"
                aria-label="Выбранные участники"
              >
                {members.map((person) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      disabled={mutation.locked}
                      aria-label={`Убрать ${person.name}`}
                      onClick={() =>
                        setSelected((current) =>
                          current.filter((item) => item.id !== person.id),
                        )
                      }
                    >
                      <span>{person.name}</span>
                      <X size={12} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div
              className="room-people-list"
              aria-busy={peopleLoading || undefined}
            >
              {candidates.map((person) => {
                const checked = memberIds.has(person.id);
                const disabled = mutation.locked || (atLimit && !checked);
                return (
                  <label
                    key={person.id}
                    htmlFor={`${id}-member-${person.id}`}
                    className="room-person-row"
                    data-selected={checked}
                    data-disabled={disabled}
                  >
                    <Avatar person={person} size={35} />
                    <PersonCopy person={person} />
                    <Checkbox
                      id={`${id}-member-${person.id}`}
                      checked={checked}
                      disabled={disabled}
                      aria-label={`Добавить ${person.name}`}
                      onCheckedChange={(next) =>
                        setSelected((current) =>
                          next
                            ? current.some((item) => item.id === person.id) ||
                              current.length >= 199
                              ? current
                              : [...current, person]
                            : current.filter((item) => item.id !== person.id),
                        )
                      }
                    />
                  </label>
                );
              })}
              <PeopleStatus
                loading={peopleLoading}
                error={peopleError}
                empty={!candidates.length}
                query={query}
                onRetry={mutation.busy ? undefined : onRetryPeople}
              />
            </div>
            <p className="room-note" aria-live="polite">
              {atLimit
                ? 'Выбрано 199 человек — группа заполнена.'
                : 'До 200 участников, включая тебя. Добавить людей можно и позже.'}
            </p>
          </div>
          {mutation.error && (
            <p className="room-error" role="alert">
              {mutation.error}
            </p>
          )}
          <div className="room-dialog-actions">
            <button
              type="button"
              className="room-secondary-button"
              disabled={mutation.busy}
              onClick={() => mutation.changeOpen(false)}
            >
              Отмена
            </button>
            <button
              type="submit"
              className="room-primary-button"
              disabled={
                mutation.busy ||
                !name.trim() ||
                (visibility === 'public' && !username.trim())
              }
            >
              {mutation.busy ? (
                <LoaderCircle
                  size={17}
                  className="room-spinner"
                  aria-hidden="true"
                />
              ) : (
                <Users size={17} aria-hidden="true" />
              )}
              {mutation.busy ? 'Создаём группу…' : 'Создать группу'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The owner starts the E2EE handshake in onSubmit; this dialog performs no requests. */
export function SelectSecretPeerDialog({
  open,
  onOpenChange,
  people,
  ownerId,
  peopleLoading,
  peopleError,
  onQueryChange,
  onRetryPeople,
  onSubmit,
}: ControlledRoomDialogProps &
  RoomPeopleProps & {
    onSubmit: (person: RoomPerson) => Promise<void>;
  }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<RoomPerson | null>(null);
  const mutation = useRoomSubmit(onOpenChange);
  const candidates = eligiblePeople(
    people,
    ownerId,
    onQueryChange ? '' : query,
  );
  const recipient = selected?.id !== ownerId ? selected : null;
  const changeQuery = (next: string) => {
    setQuery(next);
    onQueryChange?.(next);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={mutation.changeOpen}
      onOpenChangeComplete={(next) => {
        if (!next) {
          changeQuery('');
          setSelected(null);
          mutation.setError('');
        }
      }}
    >
      <DialogContent
        className="noct-dialog room-create-dialog room-secret-dialog"
        overlayClassName="room-dialog-overlay"
        showCloseButton={false}
      >
        <button
          type="button"
          className="room-dialog-close"
          aria-label="Закрыть создание секретного чата"
          disabled={mutation.busy}
          onClick={() => mutation.changeOpen(false)}
        >
          <X size={18} aria-hidden="true" />
        </button>
        <div className="room-dialog-heading">
          <span className="room-heading-symbol room-secret-symbol">
            <LockKeyhole size={23} aria-hidden="true" />
          </span>
          <div>
            <DialogTitle>Секретный чат</DialogTitle>
            <DialogDescription>
              Личный разговор на этих устройствах.
            </DialogDescription>
          </div>
        </div>
        <div className="room-secret-explainer">
          <p>
            <ShieldCheck size={18} aria-hidden="true" />
            <span>
              <strong>Сквозное шифрование</strong>Ключи остаются у участников.
              После подключения сверь код безопасности с собеседником.
            </span>
          </p>
          <p>
            <Smartphone size={18} aria-hidden="true" />
            <span>
              <strong>Привязан к устройствам</strong>История не появится в
              других сеансах. При потере ключей на устройстве её нельзя
              восстановить.
            </span>
          </p>
        </div>
        <div className="room-members-section">
          <div className="room-section-heading">
            <h3>С кем начнём?</h3>
          </div>
          <PeopleSearch
            id={`${id}-search`}
            query={query}
            onChange={changeQuery}
            disabled={mutation.locked}
          />
          <div
            className="room-people-list room-secret-people"
            aria-busy={peopleLoading || undefined}
          >
            {candidates.map((person) => (
              <button
                type="button"
                key={person.id}
                className="room-person-row"
                data-selected={recipient?.id === person.id}
                aria-pressed={recipient?.id === person.id}
                disabled={mutation.locked}
                onClick={() => setSelected(person)}
              >
                <Avatar person={person} size={37} />
                <PersonCopy person={person} />
                <span className="room-person-check" aria-hidden="true">
                  {recipient?.id === person.id && <Check size={14} />}
                </span>
              </button>
            ))}
            <PeopleStatus
              loading={peopleLoading}
              error={peopleError}
              empty={!candidates.length}
              query={query}
              onRetry={mutation.busy ? undefined : onRetryPeople}
            />
          </div>
          {recipient && (
            <p className="room-note" aria-live="polite">
              Собеседник: <strong>{recipient.name}</strong>
            </p>
          )}
        </div>
        {mutation.error && (
          <p className="room-error" role="alert">
            {mutation.error}
          </p>
        )}
        <div className="room-dialog-actions">
          <button
            type="button"
            className="room-secondary-button"
            disabled={mutation.busy}
            onClick={() => mutation.changeOpen(false)}
          >
            Отмена
          </button>
          <button
            type="button"
            className="room-primary-button"
            disabled={mutation.busy || !recipient}
            onClick={() => {
              if (recipient) void mutation.submit(() => onSubmit(recipient));
            }}
          >
            {mutation.busy ? (
              <LoaderCircle
                size={17}
                className="room-spinner"
                aria-hidden="true"
              />
            ) : (
              <LockKeyhole size={16} aria-hidden="true" />
            )}
            {mutation.busy ? 'Создаём чат…' : 'Начать секретный чат'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
