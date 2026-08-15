import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import {
  createJournal,
  getJournal,
  getJournalYears,
  voidJournal,
  type Flag,
  type JournalEntry,
  type JournalFilter,
  type Mood,
} from '../../api/journal';
import { parseVNNumber } from '../../lib/format';
import { FLAG_FILTER_OPTIONS, MONTH_OPTIONS } from './constants';
import { Composer, type JournalDraft } from './Composer';
import { JournalList } from './JournalList';
import { LoadMore } from './LoadMore';
import '../../styles/journal.css';

type ScreenState = 'loading' | 'ready' | 'error' | 'forbidden';

function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Đã xảy ra lỗi.';
}

const ALL_FILTER: JournalFilter = { year: 'all', month: 'all', flag: 'all' };

export function JournalScreen() {
  const [state, setState] = useState<ScreenState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [filter, setFilter] = useState<JournalFilter>(ALL_FILTER);

  /**
   * Trang CAO NHẤT đã tải, không phải "trang đang xem": danh sách nối thêm chứ
   * không thay trang, nên lúc nào cũng đang bày trang 1..page.
   */
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [paged, setPaged] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');

  const [draft, setDraft] = useState<JournalDraft>({
    mood: 'neutral',
    flag: 'none',
    vnindex: '',
    body: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback((ignore: { current: boolean }, f: JournalFilter) => {
    Promise.all([getJournal(f, 1), getJournalYears()]).then(
      ([res, ys]) => {
        if (ignore.current) return;
        setEntries(res.items);
        setTotal(res.total);
        setPaged(res.paged);
        setPage(1);
        setYears(ys.years);
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
  }, []);

  useEffect(() => {
    const ignore = { current: false };
    load(ignore, ALL_FILTER);
    return () => {
      ignore.current = true;
    };
  }, [load]);

  /** Lọc ở phía server để không phải tự cắt dữ liệu ở client. Đổi lọc = về trang 1. */
  const applyFilter = async (next: JournalFilter) => {
    setFilter(next);
    setFormError('');
    setMoreError('');
    try {
      const res = await getJournal(next, 1);
      setEntries(res.items);
      setTotal(res.total);
      setPaged(res.paged);
      setPage(1);
    } catch (err) {
      setFormError(errorMessageOf(err));
    }
  };

  const handleLoadMore = async () => {
    setLoadingMore(true);
    setMoreError('');
    try {
      const next = page + 1;
      const res = await getJournal(filter, next);
      // Nối, không thay: phần người dùng đang đọc phải đứng yên.
      setEntries((cur) => [...cur, ...res.items]);
      setTotal(res.total);
      setPage(next);
    } catch (err) {
      setMoreError(errorMessageOf(err));
    } finally {
      setLoadingMore(false);
    }
  };

  /**
   * Nạp lại ĐÚNG phần đang bày (trang 1..page), không phải chỉ trang 1.
   *
   * Thêm hoặc xoá một ghi chép làm mọi mục phía sau dịch chỗ. Chỉ nạp lại trang 1 thì
   * các trang đã tải phía dưới thành số liệu cũ và sẽ có mục lặp hoặc mất; giữ nguyên
   * không nạp lại thì mục vừa xoá vẫn nằm đó. Nạp lại cả dải là cách duy nhất đúng.
   */
  const refresh = useCallback(async () => {
    const pages = Array.from({ length: page }, (_, i) => i + 1);
    const [results, ys] = await Promise.all([
      Promise.all(pages.map((p) => getJournal(filter, p))),
      getJournalYears(),
    ]);
    const merged = results.flatMap((r) => r.items);
    const last = results[results.length - 1];

    setEntries(merged);
    setTotal(last.total);
    setPaged(last.paged);
    // Xoá nhiều đến mức hụt cả một trang thì lùi page cho khớp, không để nó treo ở
    // số cũ rồi lần Tải thêm sau nhảy cóc mất một trang.
    if (merged.length === 0 && page > 1) setPage(1);
    setYears(ys.years);
  }, [filter, page]);

  const handleSubmit = async () => {
    const body = draft.body.trim();
    if (!body) {
      setFormError('Cần nhập ghi chú / nhận định.');
      return;
    }
    const vn = draft.vnindex.trim();
    setSubmitting(true);
    setFormError('');
    try {
      await createJournal({
        mood: draft.mood,
        flag: draft.flag,
        // Để trống thì gửi null, không gửi 0 — cột vnindex là nullable
        vnindex: vn === '' ? null : String(parseVNNumber(vn)),
        body,
      });
      setDraft((d) => ({ ...d, vnindex: '', body: '' }));
      await refresh();
    } catch (err) {
      setFormError(errorMessageOf(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoid = async (id: string) => {
    setFormError('');
    try {
      await voidJournal(id);
      await refresh();
    } catch (err) {
      setFormError(errorMessageOf(err));
    }
  };

  if (state === 'loading') {
    return (
      <div className="gf-jn-state">
        <div className="gf-jn-state-title">Đang tải dữ liệu…</div>
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div className="gf-jn-state">
        <div className="gf-jn-state-title">Bạn không có quyền truy cập màn này.</div>
        <div>Vui lòng liên hệ quản trị viên để được cấp quyền.</div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="gf-jn-state">
        <div className="gf-jn-state-title">Không tải được dữ liệu.</div>
        <div>{errorMessage}</div>
        <button
          type="button"
          onClick={() => {
            setState('loading');
            load({ current: false }, filter);
          }}
        >
          Thử lại
        </button>
      </div>
    );
  }

  const yearOptions = [
    { value: 'all', label: 'Tất cả năm' },
    ...years.map((y) => ({ value: String(y), label: `Năm ${y}` })),
  ];

  return (
    <div className="gf-jn">
      <Composer
        draft={draft}
        submitting={submitting}
        error={formError}
        onMoodChange={(mood: Mood) => setDraft((d) => ({ ...d, mood }))}
        onFlagChange={(flag: Flag) => setDraft((d) => ({ ...d, flag }))}
        onFieldChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
        onSubmit={handleSubmit}
      />

      <div className="gf-jn-listhead">
        <div className="gf-jn-title" style={{ marginBottom: 0 }}>
          Nhật ký đã ghi
        </div>
        <div className="gf-jn-filters">
          <select value={filter.year} onChange={(e) => applyFilter({ ...filter, year: e.target.value })}>
            {yearOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select value={filter.month} onChange={(e) => applyFilter({ ...filter, month: e.target.value })}>
            {MONTH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select value={filter.flag} onChange={(e) => applyFilter({ ...filter, flag: e.target.value })}>
            {FLAG_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <JournalList entries={entries} onVoid={handleVoid} />

      <LoadMore
        shown={entries.length}
        total={total}
        paged={paged}
        loading={loadingMore}
        error={moreError}
        onLoadMore={handleLoadMore}
      />
    </div>
  );
}
