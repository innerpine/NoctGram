'use client';
import { useState } from 'react';
import {
  UserRound,
  Palette,
  Shield,
  Music2,
  KeyRound,
  Pencil,
  ChevronRight,
  Plug,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { Person } from '@/lib/client';
import { Avatar } from './post-card';
import { DisplayName, AnimationPreference } from './profile-identity';
import { AccountSwitcher } from './account-switcher';
import { AccountPanel } from './account-panel';
import { PrivacyPanel } from './privacy-panel';
import { MusicActivitySettings } from './music-activity';
import { RainSettings } from './rain-settings';

const sections = [
  { id: 'profile', label: 'Профиль', icon: UserRound },
  { id: 'appearance', label: 'Оформление', icon: Palette },
  { id: 'privacy', label: 'Приватность', icon: Shield },
  { id: 'music', label: 'Музыка', icon: Music2 },
  { id: 'access', label: 'Доступ', icon: KeyRound },
] as const;
export type SettingsSection = (typeof sections)[number]['id'];

export function SettingsPanel({
  me,
  initialSection = 'profile',
  onEdit,
  onMusicServices,
  onChanged,
}: {
  me: Person;
  initialSection?: SettingsSection;
  onEdit: (tab: 'profile' | 'design') => void;
  onMusicServices: () => void;
  onChanged: () => void;
}) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  // Mount sections when first opened, then retain drafts while switching tabs.
  const [visited, setVisited] = useState<SettingsSection[]>([initialSection]);
  return (
    <Tabs
      className="settings-workspace"
      value={section}
      onValueChange={(value) => {
        const next = sections.find((item) => item.id === value)?.id;
        if (!next) return;
        setSection(next);
        setVisited((previous) =>
          previous.includes(next) ? previous : [...previous, next],
        );
      }}
    >
      <TabsList className="settings-navigation" aria-label="Разделы настроек">
        {sections.map(({ id, label, icon: Icon }) => (
          <TabsTrigger
            key={id}
            value={id}
            className="settings-tab"
            title={label}
          >
            <Icon size={20} strokeWidth={1.7} />
            <span>{label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {sections.map(({ id, label }) => (
        <TabsContent key={id} value={id} keepMounted className="settings-page">
          {visited.includes(id) && (
            <>
              <h2 className="settings-page-title">
                {label === 'Доступ' ? 'Доступ и безопасность' : label}
              </h2>
              {id === 'profile' && (
                <>
                  <div className="settings-identity">
                    <Avatar person={me} size={64} />
                    <div>
                      <strong>
                        <DisplayName person={me} />
                      </strong>
                      <span>@{me.handle}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="settings-link-row"
                    onClick={() => onEdit('profile')}
                  >
                    <Pencil size={19} />
                    <span>
                      <strong>Редактировать профиль</strong>
                      <small>Имя, юзернеймы, фото и описание</small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                  <AccountSwitcher userId={me.id} />
                </>
              )}
              {id === 'appearance' && (
                <>
                  <button
                    type="button"
                    className="settings-link-row"
                    onClick={() => onEdit('design')}
                  >
                    <Palette size={19} />
                    <span>
                      <strong>Оформление профиля</strong>
                      <small>Цвета, фон, аватар и музыкальный статус</small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                  <AnimationPreference />
                  <RainSettings />
                </>
              )}
              {id === 'privacy' && <PrivacyPanel onChanged={onChanged} />}
              {id === 'music' && (
                <>
                  <MusicActivitySettings />
                  <button
                    type="button"
                    className="settings-link-row"
                    onClick={onMusicServices}
                  >
                    <Plug size={19} />
                    <span>
                      <strong>Музыкальные сервисы</strong>
                      <small>Подключённые аккаунты и источники музыки</small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                </>
              )}
              {id === 'access' && <AccountPanel />}
            </>
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}
