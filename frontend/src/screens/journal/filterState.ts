import type { JournalFilter } from '../../api/journal';

export const ALL_FILTER: JournalFilter = {
  year: 'all',
  month: 'all',
  day: 'all',
  flag: 'all',
  mood: 'all',
};

/** Có ít nhất một điều kiện đang bật. Dùng để quyết định hiện nút Xóa bộ lọc. */
export function isFiltering(f: JournalFilter): boolean {
  return (
    f.year !== 'all' || f.month !== 'all' || f.day !== 'all' || f.flag !== 'all' || f.mood !== 'all'
  );
}
