import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../api/client';
import {
  getQuotes,
  getSymbols,
  upsertSymbol,
  type Quote,
  type QuotesResponse,
  type Symbol,
} from '../../api/market';
import { putManualQuotes } from '../../api/overview';
import { formatDateTimeVN, formatDateVN, parseVNNumber, toDong } from '../../lib/format';
import { BoardTable, type BoardRow } from './BoardTable';
import { SymbolForm, type SymbolDraft } from './SymbolForm';
import '../../styles/board.css';

type ScreenState = 'loading' | 'ready' | 'error' | 'forbidden';

/** Ba tab cố định theo thiết kế; sàn khác chỉ hiện ở "Tất cả" nếu không có mã nào. */
const BASE_TABS = ['VN30', 'HOSE', 'HNX'] as const;

function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Đã xảy ra lỗi.';
}

export function BoardScreen() {
  const [state, setState] = useState<ScreenState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [quotes, setQuotes] = useState<QuotesResponse | null>(null);

  const [tab, setTab] = useState<string>('VN30');
  const [query, setQuery] = useState('');

  const [draft, setDraft] = useState<SymbolDraft>({
    sym: '',
    name: '',
    exchange: 'HOSE',
    sector: '',
    in_vn30: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback((ignore: { current: boolean }) => {
    getSymbols().then(
      async (syms) => {
        if (ignore.current) return;
        setSymbols(syms);
        // Không gọi fin/quotes khi chưa có mã nào: syms rỗng thì endpoint sẽ tự lấy
        // các mã ĐANG NẮM, ra một bảng giá không khớp danh sách theo dõi.
        const q = syms.length > 0 ? await getQuotes(syms.map((s) => s.sym)) : null;
        if (ignore.current) return;
        setQuotes(q);
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
    load(ignore);
    return () => {
      ignore.current = true;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    const syms = await getSymbols();
    setSymbols(syms);
    setQuotes(syms.length > 0 ? await getQuotes(syms.map((s) => s.sym)) : null);
  }, []);

  // Sàn nào có mã mà không nằm trong ba tab gốc thì thêm tab, để mã đó không bị ẩn.
  const tabs = useMemo(() => {
    const extra = [...new Set(symbols.map((s) => s.exchange))].filter(
      (ex) => !BASE_TABS.includes(ex as (typeof BASE_TABS)[number]),
    );
    return [...BASE_TABS, ...extra.sort(), 'Tất cả'];
  }, [symbols]);

  const rows: BoardRow[] = useMemo(() => {
    const q = query.trim().toUpperCase();
    return symbols
      .filter((s) => {
        if (tab === 'Tất cả') return true;
        if (tab === 'VN30') return s.in_vn30;
        return s.exchange === tab;
      })
      .filter((s) => q === '' || s.sym.includes(q) || s.name.toUpperCase().includes(q))
      .map((s) => ({ info: s, quote: (quotes?.quotes[s.sym] ?? null) as Quote | null }));
  }, [symbols, quotes, tab, query]);

  const handleDraftChange = <K extends keyof SymbolDraft>(key: K, value: SymbolDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const handleAddSymbol = async () => {
    const sym = draft.sym.trim().toUpperCase();
    if (!sym) {
      setFormError('Cần nhập mã CP.');
      return;
    }
    setSubmitting(true);
    setFormError('');
    setNotice('');
    try {
      await upsertSymbol({
        sym,
        name: draft.name.trim(),
        exchange: draft.exchange,
        sector: draft.sector.trim(),
        in_vn30: draft.in_vn30,
      });
      setDraft((d) => ({ ...d, sym: '', name: '', sector: '', in_vn30: false }));
      await refresh();
      setNotice(`Đã thêm ${sym} vào danh sách theo dõi.`);
    } catch (err) {
      setFormError(errorMessageOf(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveQuote = async () => {
    if (editing === null) return;
    const close = parseVNNumber(editValue);
    if (!close || close <= 0) {
      setFormError('Giá phải là số lớn hơn 0, nhập theo đồng/cp.');
      return;
    }
    const day = quotes?.last_trading_day;
    if (!day) {
      setFormError('Chưa xác định được phiên gần nhất.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await putManualQuotes([{ sym: editing, trade_date: day, close: String(close) }]);
      setEditing(null);
      setEditValue('');
      await refresh();
      setNotice(`Đã lưu giá thủ công cho phiên ${formatDateVN(day)}.`);
    } catch (err) {
      setFormError(errorMessageOf(err));
    } finally {
      setSaving(false);
    }
  };

  if (state === 'loading') {
    return (
      <div className="gf-board-state">
        <div className="gf-board-state-title">Đang tải bảng giá…</div>
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div className="gf-board-state">
        <div className="gf-board-state-title">Bạn không có quyền truy cập màn này.</div>
        <div>Vui lòng liên hệ quản trị viên để được cấp quyền.</div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="gf-board-state">
        <div className="gf-board-state-title">Không tải được bảng giá.</div>
        <div>{errorMessage}</div>
        <button
          type="button"
          onClick={() => {
            setState('loading');
            load({ current: false });
          }}
        >
          Thử lại
        </button>
      </div>
    );
  }

  const noQuoteAtAll = rows.length > 0 && rows.every((r) => r.quote === null);

  return (
    <div className="gf-board">
      {/* Nói thẳng ngay đầu màn: đây là giá CUỐI PHIÊN, không phải realtime. */}
      <div className="gf-board-banner">
        <span>ⓘ</span>
        <div>
          Bảng này dùng <b>giá đóng cửa (EOD)</b>, không phải giá khớp trực tiếp — chưa có nguồn realtime. Cột{' '}
          <b>Khớp</b> là giá đóng cửa phiên gần nhất, <b>TC</b> là giá đóng cửa phiên trước đó, còn{' '}
          <b>Trần/Sàn</b> được suy ra từ TC theo biên độ của sàn.{' '}
          {quotes && (
            <>
              Phiên gần nhất: <b>{formatDateVN(quotes.last_trading_day)}</b> · đọc lúc{' '}
              {formatDateTimeVN(quotes.as_of)}.
            </>
          )}
        </div>
      </div>

      {quotes?.is_stale && quotes.stale_reason && (
        <div className="gf-board-warn">
          <span>⚠</span>
          <div>
            <b>Dữ liệu giá chưa đầy đủ.</b> {quotes.stale_reason}
          </div>
        </div>
      )}

      <SymbolForm
        draft={draft}
        submitting={submitting}
        error={formError}
        onChange={handleDraftChange}
        onSubmit={handleAddSymbol}
      />

      {notice && <div className="gf-board-ok">{notice}</div>}

      <div className="gf-board-table-panel">
        <div className="gf-board-head">
          <div className="gf-board-tabs">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                className={`gf-board-tab${tab === t ? ' on' : ''}`}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="gf-board-search">
            <span>🔍</span>
            <input
              type="text"
              placeholder="Tìm mã cổ phiếu…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {symbols.length === 0 ? (
          <div className="gf-board-empty">
            <b>Chưa có mã nào trong danh sách theo dõi.</b>
            <div>
              Bảng giá lấy danh sách từ bảng mã tham chiếu, không tự sinh. Thêm mã ở khối phía trên — chọn đúng sàn để
              tính được Trần/Sàn.
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="gf-board-empty">
            <b>Không có mã nào khớp bộ lọc.</b>
            <div>
              Tab <b>{tab}</b>
              {query.trim() !== '' && (
                <>
                  {' '}
                  với từ khoá “<b>{query.trim()}</b>”
                </>
              )}{' '}
              chưa có mã nào. Thử tab <b>Tất cả</b>.
            </div>
          </div>
        ) : (
          <>
            <BoardTable
              rows={rows}
              editing={editing}
              editValue={editValue}
              saving={saving}
              onStartEdit={(sym) => {
                setEditing(sym);
                // Điền sẵn giá đang lưu để thấy đang là bao nhiêu trước khi sửa — nhưng
                // CHỈ khi giá đó thuộc đúng phiên sắp ghi. Giá của phiên cũ hơn thì để
                // trống, vì điền sẵn rồi bấm Lưu là đóng dấu giá cũ thành giá phiên mới.
                const q = quotes?.quotes[sym] ?? null;
                const sameSession = q !== null && q.trade_date === quotes?.last_trading_day;
                setEditValue(sameSession ? toDong(Number(q.close_price)) : '');
                setFormError('');
                setNotice('');
              }}
              onEditChange={setEditValue}
              onCancelEdit={() => {
                setEditing(null);
                setEditValue('');
              }}
              onSaveEdit={handleSaveQuote}
            />

            {noQuoteAtAll && (
              <div className="gf-board-empty sub">
                <b>Chưa có giá cho mã nào.</b>
                <div>
                  Bảng <code>fin_quote_history</code> đang rỗng vì chưa nối nguồn giá tự động. Bấm <b>nhập giá</b> ở
                  cuối mỗi dòng để nhập tay giá đóng cửa phiên gần nhất.
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="gf-board-note">
        <b>Cột KL để trống vì chưa có dữ liệu khối lượng.</b> Bảng <code>fin_quote_history</code> chỉ lưu giá đóng cửa,
        không có cột volume, nên ô này để <b>—</b> chứ không lấy số nào khác thay vào. Cần khối lượng thì phải bổ sung
        cột và nguồn nạp trước.
        <br />
        <b>Trần/Sàn là số suy ra, không phải số lấy từ sàn.</b> Trần = bội số bước giá lớn nhất còn ≤ TC × (1 + biên);
        Sàn = bội số nhỏ nhất còn ≥ TC × (1 − biên). Biên: HOSE 7% · HNX 10% · UPCOM 15%. Bước giá HOSE: 10 ₫ dưới
        10.000, 50 ₫ tới 49.950, 100 ₫ từ 50.000; HNX và UPCOM 100 ₫. Chưa xử lý ETF, chứng quyền, ngày giao dịch đầu
        tiên và ngày sau hưởng quyền — các trường hợp này có biên riêng, mã chưa khai sàn thì hai cột để <b>—</b>.
      </div>
    </div>
  );
}
