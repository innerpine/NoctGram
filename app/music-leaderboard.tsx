'use client';
import { DisplayName } from './profile-identity';
import { useState, type CSSProperties } from 'react';
import { ChevronDown, Headphones, Trophy } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { Person } from '@/lib/client';
import { Avatar } from './post-card';

export type ListenerScore = {
  rank: number | null;
  plays: number;
  tracks: number;
  participants: number;
};
type Listener = Person & { plays: number; tracks: number };

export function MusicLeaderboard({
  listeners,
  profile,
  mine,
  period,
  onProfile,
}: {
  listeners: Listener[];
  profile: Person | null;
  mine: ListenerScore | null;
  period: string;
  onProfile: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const row = (person: Listener, index: number) => (
    <button
      className="music-ranking-row music-listener"
      key={person.id}
      style={{ '--row-index': Math.min(index, 5) } as CSSProperties}
      data-place={index + 1}
      onClick={() => onProfile(person.id)}
    >
      <span className="music-rank">{String(index + 1).padStart(2, '0')}</span>
      <Avatar person={person} size={36} />
      <span>
        <strong>
          <DisplayName person={person} />
        </strong>
        <small>@{person.handle}</small>
      </span>
      <span className="music-listener-score">
        <b key={person.plays}>{person.plays.toLocaleString('ru')}</b>
        <small>прослушиваний</small>
      </span>
    </button>
  );
  return (
    <section className="music-leaderboard" aria-label="Топ слушателей">
      <div className="music-section-heading">
        <Trophy size={18} />
        <h3>Топ слушателей</h3>
        <span>{period === 'today' ? 'Сегодня' : `${period} дней`}</span>
      </div>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="music-leaderboard-preview">
          {listeners.slice(0, 5).map(row)}
        </div>
        {!listeners.length && (
          <div className="music-leaderboard-empty">
            <Headphones size={22} />
            <span>Слушайте музыку — здесь появится первый топ.</span>
          </div>
        )}
        <CollapsibleContent className="music-leaderboard-expansion">
          <div className="music-leaderboard-scroll">
            {listeners.slice(5, 25).map((person, i) => row(person, i + 5))}
          </div>
        </CollapsibleContent>
        {listeners.length > 5 && (
          <CollapsibleTrigger className="music-leaderboard-toggle">
            <span>{expanded ? 'Свернуть до топ-5' : 'Показать топ-25'}</span>
            <ChevronDown size={16} />
          </CollapsibleTrigger>
        )}
      </Collapsible>
      {profile && (
        <button
          className="music-ranking-row music-listener-self"
          onClick={() => onProfile(profile.id)}
        >
          <Avatar person={profile} size={36} />
          <span>
            <strong>
              <DisplayName person={profile} />
              <em>Вы</em>
            </strong>
            <small>
              {mine?.rank
                ? `${mine.rank.toLocaleString('ru')} место`
                : 'Пока без места'}
            </small>
          </span>
          <span className="music-listener-score">
            <b key={mine?.plays}>{(mine?.plays || 0).toLocaleString('ru')}</b>
            <small>прослушиваний</small>
          </span>
        </button>
      )}
    </section>
  );
}
