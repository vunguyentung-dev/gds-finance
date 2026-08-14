import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../api/client';
import {
  createEntry,
  deleteEntry,
  getCategories,
  getEntries,
  getInvested,
  getSummary,
  type EntryType,
  type FinCategories,
  type FinEntry,
  type FinSummary,
  type Invested,
} from '../../api/finance';
import { parseVNNumber, todayIso } from '../../lib/format';
import { categoryColor } from './constants';
import { isInvType, overdrawError } from './entryType';
import { StatCards } from './StatCards';
import { MonthlyChart } from './MonthlyChart';
import { CategoryBreakdown } from './CategoryBreakdown';
import { EntryForm, type DraftState } from './EntryForm';
import { LedgerTable } from './LedgerTable';
import '../../styles/finance.css';

type ScreenState = 'loading' | 'ready' | 'error' | 'forbidden';

const MONTH_OPTIONS = [
  { value: 'auto', label: 'Tháng mới nhất' },
  ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `Tháng ${i + 1}` })),
];

function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Đã xảy ra lỗi.';
}

export function FinanceScreen() {
  const [state, setState] = useState<ScreenState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [categories, setCategories] = useState<FinCategories | null>(null);
  const [entries, setEntries] = useState<FinEntry[] | null>(null);
  const [summary, setSummary] = useState<FinSummary | null>(null);
  /**
   * Đọc riêng, KHÔNG gộp vào Promise.all bên dưới. fin/invested là endpoint mới; nếu
   * backend chưa áp patch thì nó trả 404, và gộp vào sẽ làm cả màn không tải được.
   * Đọc riêng thì thiếu vốn ròng chỉ mất một thẻ, phần còn lại chạy bình thường.
   */
  const [invested, setInvested] = useState<Invested | null>(null);

  const [yearFilter, setYearFilter] = useState('auto');
  const [monthFilter, setMonthFilter] = useState('auto');

  const [draft, setDraft] = useState<DraftState>({
    type: 'out',
    date: todayIso(),
    amount: '',
    note: '',
    cat: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const loadInitial = useCallback(
    (ignore: { current: boolean }) => {
      getInvested().then(
        (inv) => {
          if (!ignore.current) setInvested(inv);
        },
        () => {
          /* endpoint chưa có: giữ null, thẻ vốn hiện — */
        },
      );

      Promise.all([getCategories(), getEntries(), getSummary()]).then(
        ([cats, entryList, sum]) => {
          if (ignore.current) return;
          setCategories(cats);
          setEntries(entryList);
          setSummary(sum);
          setDraft((d) => ({ ...d, cat: cats.out[0] ?? '' }));
          setState('ready');
        },
        (err) => {
          if (ignore.current) return;
          if (isForbidden(err)) {
            setState('forbidden');
          } else {
            setErrorMessage(errorMessageOf(err));
            setState('error');
          }
        },
      );
    },
    [],
  );

  useEffect(() => {
    const ignore = { current: false };
    loadInitial(ignore);
    return () => {
      ignore.current = true;
    };
  }, [loadInitial]);

  const handleYearChange = async (value: string) => {
    setYearFilter(value);
    try {
      const sum = await getSummary(value === 'auto' ? undefined : Number(value));
      setSummary(sum);
    } catch (err) {
      setFormError(errorMessageOf(err));
    }
  };

  const refreshAfterMutation = useCallback(async () => {
    const [entryList, sum] = await Promise.all([
      getEntries(),
      getSummary(yearFilter === 'auto' ? undefined : Number(yearFilter)),
    ]);
    setEntries(entryList);
    setSummary(sum);
    // Vốn ròng đọc lại NGAY sau mỗi lần ghi/xóa, không đợi tải lại trang.
    // Lỗi ở đây không được làm hỏng phần đã cập nhật xong ở trên.
    try {
      setInvested(await getInvested());
    } catch {
      /* giữ số cũ, thà cũ còn hơn xoá mất số đang hiện */
    }
  }, [yearFilter]);

  const handleTypeChange = (type: EntryType) => {
    // Khoản đầu tư không có danh mục — cat để rỗng, backend tự đóng dấu theo chiều.
    setDraft((d) => ({
      ...d,
      type,
      cat: isInvType(type) ? '' : categories?.[type]?.[0] ?? '',
    }));
  };

  const handleFieldChange = (key: 'date' | 'amount' | 'note' | 'cat', value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const handleSubmit = async () => {
    // Ô nhập theo ĐỒNG đầy đủ — gửi thẳng, không quy đổi. DB cũng lưu theo đồng.
    const amountDong = parseVNNumber(draft.amount);
    const isInv = isInvType(draft.type);
    if (!amountDong || !draft.date) return;
    if (!isInv && !draft.cat) return;

    // Chặn tại client cho phản hồi tức thì; backend vẫn kiểm lại lần nữa vì client
    // có thể đang giữ số vốn ròng cũ.
    const overdraw = overdrawError(draft.type, amountDong, invested?.net ?? null);
    if (overdraw) {
      setFormError(overdraw);
      return;
    }

    setSubmitting(true);
    setFormError('');
    try {
      await createEntry({
        entry_type: draft.type,
        amount: String(amountDong),
        ...(isInv ? {} : { cat: draft.cat }),
        note: draft.note.trim(),
        entry_date: draft.date,
      });
      setDraft((d) => ({ ...d, amount: '', note: '' }));
      await refreshAfterMutation();
    } catch (err) {
      setFormError(errorMessageOf(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    setFormError('');
    try {
      await deleteEntry(id);
      await refreshAfterMutation();
    } catch (err) {
      setFormError(errorMessageOf(err));
    }
  };

  const curYear = summary?.year ?? new Date().getFullYear();

  const monthsWithData = useMemo(() => {
    if (!summary) return [];
    const months: number[] = [];
    summary.monthly.forEach((m, idx) => {
      if (m.in > 0 || m.out > 0) months.push(idx + 1);
    });
    return months.sort((a, b) => b - a);
  }, [summary]);

  const curMonth = monthFilter === 'auto' ? monthsWithData[0] ?? new Date().getMonth() + 1 : Number(monthFilter);

  const yearOptions = useMemo(() => {
    const opts = [{ value: 'auto', label: 'Năm mới nhất' }];
    (summary?.years ?? []).forEach((y) => opts.push({ value: String(y), label: `Năm ${y}` }));
    return opts;
  }, [summary]);

  const chartBars = useMemo(() => {
    if (!summary) return [];
    const max = Math.max(1, ...summary.monthly.flatMap((m) => [m.in, m.out]));
    return summary.monthly.map((m, idx) => ({
      label: `T${idx + 1}`,
      inPct: (m.in / max) * 100,
      outPct: (m.out / max) * 100,
    }));
  }, [summary]);

  const catList = useMemo(() => {
    if (!summary) return [];
    return Object.entries(summary.catTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => ({
        name,
        amount,
        pct: summary.outYear > 0 ? (amount / summary.outYear) * 100 : 0,
        color: categoryColor(name),
      }));
  }, [summary]);

  if (state === 'loading') {
    return (
      <div className="gf-fin-state">
        <div className="gf-fin-state-title">Đang tải dữ liệu…</div>
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div className="gf-fin-state">
        <div className="gf-fin-state-title">Bạn không có quyền truy cập màn này.</div>
        <div>Vui lòng liên hệ quản trị viên để được cấp quyền.</div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="gf-fin-state">
        <div className="gf-fin-state-title">Không tải được dữ liệu.</div>
        <div>{errorMessage}</div>
        <button
          type="button"
          onClick={() => {
            setState('loading');
            loadInitial({ current: false });
          }}
        >
          Thử lại
        </button>
      </div>
    );
  }

  if (!categories || !entries || !summary) return null;

  return (
    <div className="gf-finance">
      <div className="gf-finance-filters">
        <select value={yearFilter} onChange={(e) => handleYearChange(e.target.value)}>
          {yearOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
          {MONTH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <StatCards summary={summary} curYear={curYear} curMonth={curMonth} invested={invested} />

      <div className="gf-finance-charts">
        <MonthlyChart bars={chartBars} yearLabel={`Năm ${curYear}`} />
        <CategoryBreakdown items={catList} yearLabel={`Năm ${curYear}`} />
      </div>

      <EntryForm
        draft={draft}
        categories={categories}
        investedNet={invested?.net ?? null}
        submitting={submitting}
        error={formError}
        onTypeChange={handleTypeChange}
        onFieldChange={handleFieldChange}
        onSubmit={handleSubmit}
      />

      <LedgerTable entries={entries} onDelete={handleDelete} />
    </div>
  );
}
