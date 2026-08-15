import type { JournalFilter } from '../../api/journal';
import { FLAG_FILTER_OPTIONS, MONTH_OPTIONS, MOOD_FILTER_OPTIONS, daysInMonth } from './constants';
import { ALL_FILTER, isFiltering } from './filterState';

interface Props {
  filter: JournalFilter;
  /** Năm có ghi chép, giảm dần. */
  years: number[];
  /** Tháng có ghi chép theo từng năm. Thiếu (backend chưa áp patch) thì hiện đủ 12. */
  monthsByYear?: Record<string, number[]>;
  /** Số ghi chép khớp bộ lọc hiện tại. */
  total: number;
  /** Tổng số ghi chép khi KHÔNG lọc gì. */
  grandTotal: number;
  onChange: (next: JournalFilter) => void;
}

export function JournalFilters({ filter, years, monthsByYear, total, grandTotal, onChange }: Props) {
  const filtering = isFiltering(filter);

  const yearOptions = [
    { value: 'all', label: 'Tất cả năm' },
    ...years.map((y) => ({ value: String(y), label: `Năm ${y}` })),
  ];

  // Chọn năm cụ thể thì chỉ bày tháng THỰC SỰ có ghi chép. Bày đủ 12 tháng mà 9
  // tháng chọn vào là rỗng thì người dùng phải dò từng cái mới biết tháng nào có.
  const availableMonths = filter.year === 'all' ? null : monthsByYear?.[filter.year];
  const monthOptions =
    availableMonths === undefined || availableMonths === null
      ? MONTH_OPTIONS
      : [
          { value: 'all', label: 'Tất cả tháng' },
          ...[...availableMonths]
            .sort((a, b) => b - a)
            .map((m) => ({ value: String(m), label: `Tháng ${String(m).padStart(2, '0')}` })),
        ];

  // Ngày chỉ có nghĩa khi đã chốt cả năm lẫn tháng — "ngày 15" của mọi tháng mọi
  // năm không phải thứ ai muốn lọc.
  const dayEnabled = filter.year !== 'all' && filter.month !== 'all';
  const dayCount = dayEnabled ? daysInMonth(Number(filter.year), Number(filter.month)) : 31;
  const dayOptions = [
    { value: 'all', label: 'Tất cả ngày' },
    ...Array.from({ length: dayCount }, (_, i) => ({
      value: String(i + 1),
      label: `Ngày ${String(i + 1).padStart(2, '0')}`,
    })),
  ];

  /**
   * Đổi năm hoặc tháng có thể làm lựa chọn ngày hiện tại thành vô nghĩa (chọn ngày
   * 31 rồi chuyển sang tháng 2), nên nhả ngày về "tất cả" thay vì giữ một giá trị
   * lọc ra đúng 0 kết quả mà người dùng không hiểu vì sao.
   */
  const setYear = (year: string) => onChange({ ...filter, year, month: 'all', day: 'all' });
  const setMonth = (month: string) => onChange({ ...filter, month, day: 'all' });

  return (
    <div className="gf-jn-filters">
      <select value={filter.year} onChange={(e) => setYear(e.target.value)} title="Lọc theo năm">
        {yearOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select value={filter.month} onChange={(e) => setMonth(e.target.value)} title="Lọc theo tháng">
        {monthOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        value={dayEnabled ? filter.day : 'all'}
        onChange={(e) => onChange({ ...filter, day: e.target.value })}
        disabled={!dayEnabled}
        title={dayEnabled ? 'Lọc theo ngày' : 'Chọn Năm và Tháng cụ thể trước đã'}
      >
        {dayOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        value={filter.mood}
        onChange={(e) => onChange({ ...filter, mood: e.target.value })}
        title="Lọc theo cảm nhận thị trường"
      >
        {MOOD_FILTER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        value={filter.flag}
        onChange={(e) => onChange({ ...filter, flag: e.target.value })}
        title="Lọc theo cờ"
      >
        {FLAG_FILTER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <span className="gf-jn-filter-count gf-num">
        {filtering ? (
          <>
            <b>{total}</b> / {grandTotal} ghi chép
          </>
        ) : (
          <>{grandTotal} ghi chép</>
        )}
      </span>

      {filtering && (
        <button type="button" className="gf-jn-filter-clear" onClick={() => onChange(ALL_FILTER)}>
          ✕ Xóa bộ lọc
        </button>
      )}
    </div>
  );
}
