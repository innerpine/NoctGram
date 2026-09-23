import type { ReactNode } from 'react';

type IconProps = { size?: number };
function Glyph({ size = 18, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}
export function InstagramIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M17.5 6.5h.01" />
    </Glyph>
  );
}
export function TikTokIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M9 12a4 4 0 1 0 4 4V3a5 5 0 0 0 5 5" />
    </Glyph>
  );
}
export function YouTubeIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M2.5 17a24 24 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.6 49.6 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24 24 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.6 49.6 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
      <path d="m10 15 5-3-5-3z" />
    </Glyph>
  );
}
