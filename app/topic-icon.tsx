'use client';
import { useId } from 'react';
import { Hash } from 'lucide-react';
import { TOPIC_COLORS } from '@/lib/room-topic-shared';

function shade(hex: string, amount: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) =>
    Math.round(((value >> shift) & 255) * (1 - amount))
      .toString(16)
      .padStart(2, '0');
  return '#' + channel(16) + channel(8) + channel(0);
}
// A forum topic icon: a speech bubble in one of Telegram's six topic colours
// with the topic's emoji or first letter. «Общее» is a hash sign.
export function TopicIcon({
  title,
  color = 0,
  emoji = '',
  size = 32,
  general = false,
}: {
  title: string;
  color?: number;
  emoji?: string;
  size?: number;
  general?: boolean;
}) {
  const gradient = useId();
  if (general)
    return (
      <span
        className="topic-icon topic-icon-general"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <Hash size={Math.round(size * 0.58)} strokeWidth={2.4} />
      </span>
    );
  const base = TOPIC_COLORS[color] ?? TOPIC_COLORS[0];
  const letter = Array.from(title.trim())[0]?.toUpperCase() || '#';
  return (
    <svg
      className="topic-icon"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={base} />
          <stop offset="1" stopColor={shade(base, 0.28)} />
        </linearGradient>
      </defs>
      <path
        d="M16 3.2C8.9 3.2 3.2 8.3 3.2 14.6c0 3.3 1.6 6.3 4.1 8.3-.2 1.9-1.1 3.6-2.6 4.9 2.9.3 5.6-.6 7.6-2.2 1.2.3 2.4.5 3.7.5 7.1 0 12.8-5.1 12.8-11.5S23.1 3.2 16 3.2z"
        fill={`url(#${gradient})`}
        stroke={shade(base, 0.35)}
        strokeWidth="0.8"
      />
      {emoji ? (
        <text
          x="16"
          y="15"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="13"
        >
          {emoji}
        </text>
      ) : (
        <text
          x="16"
          y="15.4"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="13"
          fontWeight="700"
          fill="#fff"
        >
          {letter}
        </text>
      )}
    </svg>
  );
}
