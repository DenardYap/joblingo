import type { CSSProperties } from 'react';

// Original angular glyphs on a 24px grid. No icon-library dependency.
const paths = {
  file: 'M5 3h9l5 5v13H5V3ZM14 3v6h5M9 13h6M9 17h6',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
  download: 'M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5',
  play: 'm7 4 13 8-13 8V4Z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v6h5',
  external: 'M13 3h8v8M21 3 10 14M10 5H3v16h16v-7',
  people: 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM2 21v-3a7 7 0 0 1 14 0v3M17 4a4 4 0 0 1 0 7M19 14a6 6 0 0 1 3 5v2',
  check: 'm4 12 5 5L21 5',
  settings: 'M4 6h16M4 18h16M8 3v6M16 15v6',
  search: 'M16 16l5 5M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z',
  compose: 'M13 5H4v15h15v-9M11 13l1-4 7-7 3 3-7 7-4 1Z',
  list: 'M4 5h16M4 12h16M4 19h10',
  bookmark: 'M6 3h12v18l-6-4-6 4V3Z',
  calendar: 'M4 5h16v16H4V5ZM8 2v6M16 2v6M4 10h16M8 14h3M14 14h2M8 17h3',
  chevron: 'm8 10 4 4 4-4',
  arrow: 'M12 20V4m-7 7 7-7 7 7',
  close: 'm6 6 12 12M6 18 18 6',
  panel: 'M3 4h18v16H3V4ZM9 4v16',
  briefcase: 'M3 7h18v14H3V7ZM8 7V3h8v4M3 12h18M10 11v4h4v-4',
  location: 'M12 22S4 14 4 9a8 8 0 0 1 16 0c0 5-8 13-8 13ZM12 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  building: 'M4 21V3h11v18M15 9h5v12M2 21h20M8 7h3M8 11h3M8 15h3M8 21v-3h3v3',
  filter: 'M3 5h18M6 12h12M9 19h6',
  score: 'M4 20V12h4v8M10 20V8h4v12M16 20V3h4v17',
  sort: 'M5 3v18m-3-3 3 3 3-3M11 5h10M11 11h7M11 17h4',
  globe: 'M3 12h18M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z',
  visa: 'M4 3h16v18H4V3ZM8 16h8M8 12h8M12 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
} as const;
export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, filled = false, style }: { name: IconName; size?: number; filled?: boolean; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" focusable="false" style={style}><path d={paths[name]} /></svg>;
}
