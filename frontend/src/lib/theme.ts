export type ThemeName = 'light' | 'dark';

export interface ThemeTokens {
  bg: string;
  panel: string;
  panel2: string;
  sidebar: string;
  border: string;
  border2: string;
  fg: string;
  sub: string;
  muted: string;
  muted2: string;
  chip: string;
  accent: string;
  accentSoft: string;
  accentInk: string;
  up: string;
  down: string;
  upSoft: string;
  downSoft: string;
  heroBg: string;
  heroFg: string;
}

export const themes: Record<ThemeName, ThemeTokens> = {
  light: {
    bg: '#faf9f7',
    panel: '#ffffff',
    panel2: '#f6f4f0',
    sidebar: '#ffffff',
    border: '#eceae6',
    border2: '#f4f2ee',
    fg: '#18181b',
    sub: '#3f3f46',
    muted: '#71717a',
    muted2: '#a1a1aa',
    chip: '#e4e4e7',
    accent: 'oklch(0.54 0.16 265)',
    accentSoft: 'oklch(0.95 0.03 265)',
    accentInk: 'oklch(0.45 0.16 265)',
    up: 'oklch(0.55 0.15 150)',
    down: 'oklch(0.58 0.19 25)',
    upSoft: 'oklch(0.96 0.04 150)',
    downSoft: 'oklch(0.96 0.05 25)',
    heroBg: 'oklch(0.54 0.16 265)',
    heroFg: '#ffffff',
  },
  dark: {
    bg: '#0e1117',
    panel: '#12161f',
    panel2: '#0e1117',
    sidebar: '#12161f',
    border: '#1f2430',
    border2: '#1a1f2b',
    fg: '#f4f4f5',
    sub: '#c4c9d4',
    muted: '#8b93a1',
    muted2: '#6b7280',
    chip: '#1f2430',
    accent: 'oklch(0.78 0.12 180)',
    accentSoft: 'rgba(45,212,191,.13)',
    accentInk: 'oklch(0.84 0.12 180)',
    up: 'oklch(0.78 0.15 150)',
    down: 'oklch(0.68 0.19 25)',
    upSoft: 'rgba(52,211,153,.12)',
    downSoft: 'rgba(248,113,113,.1)',
    heroBg: 'linear-gradient(135deg, oklch(0.72 0.13 180), oklch(0.6 0.13 200))',
    heroFg: '#04211d',
  },
};

export function themeVars(theme: ThemeName): Record<string, string> {
  const tokens = themes[theme];
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    vars[`--${key}`] = value;
  }
  return vars;
}
