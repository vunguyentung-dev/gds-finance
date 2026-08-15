import type { SortState } from './sortRows';

interface Props {
  label: string;
  sortKey: string;
  sort: SortState | null;
  onSort: (key: string) => void;
  /** 'l' = căn trái, khớp class .l sẵn có của bảng. Mặc định căn phải. */
  align?: 'l';
}

/**
 * Ô tiêu đề bấm được. Dùng <button> thật thay vì gắn onClick lên <th> để còn
 * tab tới và bấm bằng bàn phím; aria-sort để trình đọc màn hình biết đang sắp theo
 * cột nào, chiều nào.
 */
export function SortHeader({ label, sortKey, sort, onSort, align }: Props) {
  const active = sort !== null && sort.key === sortKey;
  const dir = active ? sort.dir : null;

  // Cột chưa sắp vẫn hiện ↕ mờ — không có nó thì không ai đoán được là bấm được.
  const arrow = dir === null ? '↕' : dir === 'asc' ? '▲' : '▼';
  const hint =
    dir === null
      ? `Sắp xếp theo ${label}`
      : dir === 'asc'
        ? `${label} tăng dần — bấm để đảo chiều`
        : `${label} giảm dần — bấm để bỏ sắp xếp`;

  return (
    <th className={align === 'l' ? 'l' : undefined} aria-sort={dir === null ? 'none' : dir === 'asc' ? 'ascending' : 'descending'}>
      <button
        type="button"
        className={`gf-sort-btn${align === 'l' ? ' l' : ''}${active ? ' on' : ''}`}
        onClick={() => onSort(sortKey)}
        title={hint}
      >
        {label}
        <span className={`gf-sort-arrow${active ? ' on' : ''}`}>{arrow}</span>
      </button>
    </th>
  );
}
