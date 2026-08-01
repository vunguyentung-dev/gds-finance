import type { Flag, Mood } from '../../api/journal';

export interface ChipDef<T> {
  id: T;
  label: string;
  icon: string;
  color: string;
}

/** Gốc dòng 1308-1313 trong VNInvest.dc.html. */
export const moods: ChipDef<Mood>[] = [
  { id: 'greed', label: 'Hưng phấn', icon: '🤑', color: 'oklch(0.62 0.15 300)' },
  { id: 'up', label: 'Lạc quan', icon: '😀', color: 'var(--up)' },
  { id: 'neutral', label: 'Trung tính', icon: '😐', color: 'oklch(0.7 0.14 60)' },
  { id: 'down', label: 'Thận trọng', icon: '😟', color: 'oklch(0.6 0.14 40)' },
  { id: 'fear', label: 'Hoảng loạn', icon: '😱', color: 'var(--down)' },
];

/** Gốc dòng 1316-1321. */
export const flags: ChipDef<Flag>[] = [
  { id: 'none', label: 'Không', icon: '⚪', color: 'var(--muted2)' },
  { id: 'warn', label: 'Cảnh báo', icon: '🚩', color: 'var(--down)' },
  { id: 'lesson', label: 'Bài học', icon: '🟡', color: 'oklch(0.7 0.14 60)' },
  { id: 'chance', label: 'Cơ hội', icon: '🟢', color: 'var(--up)' },
  { id: 'note', label: 'Ghi nhớ', icon: '🔵', color: 'oklch(0.6 0.14 240)' },
];

const moodMap = new Map(moods.map((m) => [m.id, m]));
const flagMap = new Map(flags.map((f) => [f.id, f]));

export function moodOf(id: Mood): ChipDef<Mood> {
  return moodMap.get(id) ?? moodMap.get('neutral')!;
}

export function flagOf(id: Flag): ChipDef<Flag> {
  return flagMap.get(id) ?? flagMap.get('none')!;
}

export const MONTH_OPTIONS = [
  { value: 'all', label: 'Tất cả tháng' },
  ...Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0');
    return { value: String(i + 1), label: `Tháng ${mm}` };
  }),
];

/** Bộ lọc cờ bỏ 'none' — giống prototype, không lọc được "chưa gắn cờ". */
export const FLAG_FILTER_OPTIONS = [
  { value: 'all', label: 'Tất cả cờ' },
  ...flags.filter((f) => f.id !== 'none').map((f) => ({ value: f.id, label: `${f.icon} ${f.label}` })),
];
