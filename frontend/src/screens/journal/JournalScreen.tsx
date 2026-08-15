import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Composer, type JournalDraft } from './Composer';
import { JournalFilters } from './JournalFilters';
import { ALL_FILTER, isFiltering } from './filterState';
import { JournalList } from './JournalList';
import { Pagination } from './Pagination';
import { clampPage } from './pagerMath';
import '../../styles/journal.css';

type ScreenState = 'loading' | 'ready' | 'error' | 'forbidden';

function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Đã xảy ra lỗi.';
}

export function JournalScreen() {
  const [state, setState] = useState<ScreenState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [monthsByYear, setMonthsByYear] = useState<Record<string, number[]> | undefined>();
  const [filter, setFilter] = useState<JournalFilter>(ALL_FILTER);

  /**
   * Tổng khi KHÔNG lọc gì, để hiện "12 / 137". Chỉ đổi khi thêm/xoá ghi chép, nên
   * đổi bộ lọc không cần đọc lại — tiết kiệm một lượt gọi mỗi lần chỉnh dropdown.
   */
  const [grandTotal, setGrandTotal] = useState(0);

  /** Trang ĐANG XEM. Bấm số trang là thay cả danh sách, không nối thêm. */
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [paged, setPaged] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState('');

  const [draft, setDraft] = useState<JournalDraft>({
    mood: 'neutral',
    flag: 'none',
    vnindex: '',
    body: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  /** Đầu danh sách, để cuộn về sau khi đổi trang. */
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback((ignore: { current: boolean }, f: JournalFilter) => {
    Promise.all([getJournal(f, 1), getJournalYears()]).then(
      ([res, ys]) => {
        if (ignore.current) return;
        setEntries(res.items);
        setTotal(res.total);
        setTotalPages(res.totalPages);
        setPaged(res.paged);
        setPage(1);
        // Lần tải đầu chưa lọc gì nên total CHÍNH LÀ tổng toàn bộ.
        setGrandTotal(res.total);
        setYears(ys.years);
        setMonthsByYear(ys.months);
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

  /** Nạp một trang cụ thể, thay toàn bộ danh sách. */
  const fetchPage = useCallback(
    async (f: JournalFilter, want: number) => {
      setPageLoading(true);
      setPageError('');
      try {
        const res = await getJournal(f, want);
        setEntries(res.items);
        setTotal(res.total);
        setTotalPages(res.totalPages);
        setPaged(res.paged);
        setPage(want);
        return res;
      } catch (err) {
        setPageError(errorMessageOf(err));
        return null;
      } finally {
        setPageLoading(false);
      }
    },
    [],
  );

  /** Lọc ở phía server để không phải tự cắt dữ liệu ở client. Đổi lọc = về trang 1. */
  const applyFilter = async (next: JournalFilter) => {
    setFilter(next);
    setFormError('');
    await fetchPage(next, 1);
  };

  const handleGoTo = async (want: number) => {
    const target = clampPage(want, totalPages);
    if (target === page) return;
    await fetchPage(filter, target);
    // Đổi trang xong mà mắt vẫn ở thanh số trang dưới cùng thì không thấy nội dung
    // mới. Kéo về đầu danh sách, không kéo lên đầu màn (ô soạn thảo không liên quan).
    listRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  /**
   * Nạp lại TRANG HIỆN TẠI sau khi thêm/xoá.
   *
   * Xoá mục cuối cùng của trang cuối có thể làm trang đang đứng vượt quá số trang mới
   * — khi đó phải lùi về trang cuối còn hợp lệ, không để người dùng nhìn một trang
   * rỗng mà tưởng mất sạch dữ liệu.
   */
  const refresh = useCallback(
    async (goFirst = false) => {
      const want = goFirst ? 1 : page;
      const res = await getJournal(filter, want);
      const fixed = clampPage(want, res.totalPages);

      const final = fixed === want ? res : await getJournal(filter, fixed);
      setEntries(final.items);
      setTotal(final.total);
      setTotalPages(final.totalPages);
      setPaged(final.paged);
      setPage(fixed);

      const ys = await getJournalYears();
      setYears(ys.years);
      setMonthsByYear(ys.months);

      // Thêm/xoá làm đổi tổng, mà tổng này không suy ra được từ kết quả đã lọc.
      // per_page=1: chỉ cần con số ở header, không cần dữ liệu.
      setGrandTotal((await getJournal(ALL_FILTER, 1, 1)).total);
    },
    [filter, page],
  );

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
      // Ghi chép mới luôn nằm ĐẦU danh sách, nên nhảy về trang 1 để người dùng thấy
      // ngay thứ vừa viết. Đứng lại trang 5 thì bấm Lưu xong màn hình không đổi gì.
      await refresh(true);
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
        <JournalFilters
          filter={filter}
          years={years}
          monthsByYear={monthsByYear}
          total={total}
          grandTotal={grandTotal}
          onChange={applyFilter}
        />
      </div>

      <div ref={listRef}>
        <JournalList
          entries={entries}
          onVoid={handleVoid}
          filtering={isFiltering(filter)}
          onClearFilter={() => applyFilter(ALL_FILTER)}
        />
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        paged={paged}
        loading={pageLoading}
        error={pageError}
        onGoTo={handleGoTo}
      />
    </div>
  );
}
