import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import {
  completeRun,
  createRun,
  getRun,
  getRuns,
  putRunRows,
  updateRun,
  type HeadPatch,
  type Rec,
  type RowStatus,
  type RunDetail,
  type RunRow,
  type RunSummary,
} from '../../api/checklist';
import { describeDong, formatDateTimeVN, formatVnIndex, parseVNNumber, toDong } from '../../lib/format';
import { CriteriaTable, type RowState } from './CriteriaTable';
import { TOTAL_CRITERIA } from './defs';
import '../../styles/checklist.css';

type ScreenState = 'loading' | 'ready' | 'empty' | 'error' | 'forbidden';
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved';

const REC_OPTIONS: { id: Rec; label: string; color: string }[] = [
  { id: 'buy', label: 'Mua', color: 'var(--up)' },
  { id: 'sell', label: 'Bán', color: 'var(--down)' },
  { id: 'watch', label: 'Theo dõi', color: 'var(--muted)' },
];

interface HeadForm {
  rec: Rec;
  buyPrice: string;
  sellPrice: string;
  sellDate: string;
  vnindex: string;
}

function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Đã xảy ra lỗi.';
}

function headFormOf(d: RunDetail): HeadForm {
  return {
    rec: d.rec,
    buyPrice: d.buy_price === null ? '' : toDong(Number(d.buy_price)),
    sellPrice: d.sell_price === null ? '' : toDong(Number(d.sell_price)),
    sellDate: d.sell_date ?? '',
    vnindex: d.vnindex === null ? '' : formatVnIndex(Number(d.vnindex)),
  };
}

function rowStateOf(d: RunDetail): RowState {
  const out: RowState = {};
  for (const r of d.rows) out[r.row_key] = { row_status: r.row_status, val: r.val ?? '' };
  return out;
}

export function ChecklistScreen() {
  const [state, setState] = useState<ScreenState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [formError, setFormError] = useState('');

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [head, setHead] = useState<HeadForm | null>(null);
  const [rows, setRows] = useState<RowState>({});
  const [newSym, setNewSym] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  // Thay đổi chờ ghi — giữ ở ref để debounce không bị closure cũ
  const pendingRows = useRef<Map<string, RunRow>>(new Map());
  const pendingHead = useRef<HeadPatch | null>(null);
  const timer = useRef<number | null>(null);
  const runIdRef = useRef<string | null>(null);

  const flush = useCallback(async (silent = false) => {
    const id = runIdRef.current;
    if (!id) return;
    const rowBatch = [...pendingRows.current.values()];
    const headPatch = pendingHead.current;
    if (rowBatch.length === 0 && !headPatch) return;
    pendingRows.current = new Map();
    pendingHead.current = null;

    if (!silent) setSaveState('saving');
    try {
      if (headPatch) await updateRun(id, headPatch);
      if (rowBatch.length) await putRunRows(id, rowBatch);
      if (!silent) {
        setSaveState('saved');
        setFormError('');
      }
    } catch (err) {
      if (!silent) {
        setSaveState('dirty');
        setFormError(errorMessageOf(err));
      }
    }
  }, []);

  const schedule = useCallback(() => {
    setSaveState('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 800);
  }, [flush]);

  const openRun = useCallback(async (id: string) => {
    // Ghi nốt thay đổi của phiên đang mở trước khi chuyển
    await flush(true);
    runIdRef.current = id;
    setRunId(id);
    const d = await getRun(id);
    setDetail(d);
    setHead(headFormOf(d));
    setRows(rowStateOf(d));
    setSaveState('idle');
  }, [flush]);

  const load = useCallback(
    (ignore: { current: boolean }) => {
      getRuns().then(
        async (list) => {
          if (ignore.current) return;
          setRuns(list);
          if (list.length === 0) {
            setState('empty');
            return;
          }
          try {
            await openRun(list[0].id);
            if (!ignore.current) setState('ready');
          } catch (err) {
            if (!ignore.current) {
              setErrorMessage(errorMessageOf(err));
              setState('error');
            }
          }
        },
        (err) => {
          if (ignore.current) return;
          if (isForbidden(err)) setState('forbidden');
          else {
            setErrorMessage(errorMessageOf(err));
            setState('error');
          }
        },
      );
    },
    [openRun],
  );

  useEffect(() => {
    const ignore = { current: false };
    load(ignore);
    return () => {
      ignore.current = true;
      if (timer.current) clearTimeout(timer.current);
      void flush(true);
    };
  }, [load, flush]);

  const handleStatus = (rowKey: string, status: Exclude<RowStatus, ''>) => {
    setRows((prev) => {
      const cur = prev[rowKey] ?? { row_status: '' as RowStatus, val: '' };
      // Bấm lại đúng nút đang chọn thì bỏ chọn — giống prototype dòng 1284
      const next: RowStatus = cur.row_status === status ? '' : status;
      const updated = { ...cur, row_status: next };
      pendingRows.current.set(rowKey, { row_key: rowKey, row_status: next, val: updated.val });
      return { ...prev, [rowKey]: updated };
    });
    schedule();
  };

  const handleVal = (rowKey: string, val: string) => {
    setRows((prev) => {
      const cur = prev[rowKey] ?? { row_status: '' as RowStatus, val: '' };
      const updated = { ...cur, val };
      pendingRows.current.set(rowKey, { row_key: rowKey, row_status: updated.row_status, val });
      return { ...prev, [rowKey]: updated };
    });
    schedule();
  };

  const handleHead = (patch: Partial<HeadForm>) => {
    setHead((prev) => (prev ? { ...prev, ...patch } : prev));
    const api: HeadPatch = { ...(pendingHead.current ?? {}) };
    if (patch.rec !== undefined) api.rec = patch.rec;
    if (patch.buyPrice !== undefined) {
      api.buy_price = patch.buyPrice.trim() === '' ? null : String(parseVNNumber(patch.buyPrice));
    }
    if (patch.sellPrice !== undefined) {
      api.sell_price = patch.sellPrice.trim() === '' ? null : String(parseVNNumber(patch.sellPrice));
    }
    if (patch.sellDate !== undefined) api.sell_date = patch.sellDate === '' ? null : patch.sellDate;
    if (patch.vnindex !== undefined) {
      api.vnindex = patch.vnindex.trim() === '' ? null : String(parseVNNumber(patch.vnindex));
    }
    pendingHead.current = api;
    schedule();
  };

  const handleCreate = async () => {
    const sym = newSym.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,12}$/.test(sym)) {
      setFormError('Mã CP phải 3-12 ký tự chữ/số.');
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      await flush(true);
      const { id } = await createRun({ sym, rec: 'watch' });
      setRuns(await getRuns());
      await openRun(id);
      setNewSym('');
      setState('ready');
    } catch (err) {
      setFormError(errorMessageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const handleComplete = async () => {
    if (!runId) return;
    setBusy(true);
    setFormError('');
    try {
      await flush(true);
      await completeRun(runId);
      const [d, list] = await Promise.all([getRun(runId), getRuns()]);
      setDetail(d);
      setRuns(list);
    } catch (err) {
      setFormError(errorMessageOf(err));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') {
    return (
      <div className="gf-cl-state">
        <div className="gf-cl-state-title">Đang tải dữ liệu…</div>
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div className="gf-cl-state">
        <div className="gf-cl-state-title">Bạn không có quyền truy cập màn này.</div>
        <div>Vui lòng liên hệ quản trị viên để được cấp quyền.</div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="gf-cl-state">
        <div className="gf-cl-state-title">Không tải được dữ liệu.</div>
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

  const runBar = (
    <div className="gf-cl-runbar">
      {runs.length > 0 && (
        <div>
          <label className="gf-cl-label">Phiên đánh giá</label>
          <select value={runId ?? ''} onChange={(e) => void openRun(e.target.value)}>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.sym} · {formatDateTimeVN(r.created_at)}
                {r.done_at ? ' · đã hoàn thành' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="gf-cl-label">Tạo phiên mới</label>
        <input
          type="text"
          className="gf-cl-newsym"
          placeholder="VD: FPT"
          value={newSym}
          onChange={(e) => setNewSym(e.target.value)}
        />
      </div>
      <button type="button" className="gf-cl-btn ghost" onClick={handleCreate} disabled={busy}>
        + Phiên mới
      </button>
    </div>
  );

  if (state === 'empty' || !detail || !head) {
    return (
      <div className="gf-cl">
        <div className="gf-cl-panel">
          <div className="gf-cl-title" style={{ marginBottom: 4 }}>
            Chưa có phiên đánh giá nào
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
            Nhập mã cổ phiếu để bắt đầu một phiên checklist mới. Mỗi phiên được lưu riêng theo mã và thời điểm, nên
            lịch sử đánh giá cũ không bị ghi đè.
          </div>
          {runBar}
          {formError && <div className="gf-cl-error">{formError}</div>}
        </div>
      </div>
    );
  }

  const done = Object.values(rows).filter((r) => r.row_status === 'ok').length;
  const recColor = REC_OPTIONS.find((r) => r.id === head.rec)?.color ?? 'var(--fg)';
  const buyHint = describeDong(parseVNNumber(head.buyPrice));
  const sellHint = describeDong(parseVNNumber(head.sellPrice));

  const savingLabel =
    saveState === 'saving' ? 'Đang lưu…' : saveState === 'dirty' ? 'Chưa lưu' : saveState === 'saved' ? 'Đã lưu' : '';

  return (
    <div className="gf-cl">
      <div className="gf-cl-panel">
        <div className="gf-cl-head">
          <div className="gf-cl-title">Checklist trước khi mua/bán · {detail.sym}</div>
          <div className="gf-cl-head-right">
            {savingLabel && (
              <span className={`gf-cl-saving${saveState === 'dirty' ? ' dirty' : ''}`}>{savingLabel}</span>
            )}
            <span className="gf-cl-score">
              Tiêu chí đạt
              <b className="gf-num">
                {done}/{TOTAL_CRITERIA}
              </b>
            </span>
            <button type="button" className="gf-cl-btn" onClick={handleComplete} disabled={busy}>
              ✓ Hoàn thành
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>{runBar}</div>

        <div className="gf-cl-grid">
          <div>
            <label className="gf-cl-label">Mã cổ phiếu</label>
            <div className="gf-cl-readonly gf-num">{detail.sym}</div>
          </div>
          <div>
            <label className="gf-cl-label">Khuyến nghị</label>
            <select
              className="gf-cl-select"
              style={{ color: recColor }}
              value={head.rec}
              onChange={(e) => handleHead({ rec: e.target.value as Rec })}
            >
              {REC_OPTIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="gf-cl-label">VN-Index</label>
            <input
              type="text"
              className="gf-cl-input gf-num"
              placeholder="1.312,7"
              value={head.vnindex}
              onChange={(e) => handleHead({ vnindex: e.target.value })}
            />
          </div>
          <div>
            <label className="gf-cl-label">Thời điểm đánh giá</label>
            <div className="gf-cl-readonly gf-num">
              {detail.done_at ? formatDateTimeVN(detail.done_at) : 'Chưa hoàn thành'}
            </div>
          </div>
          <div className="gf-cl-field">
            <label className="gf-cl-label">Giá mua (₫)</label>
            <input
              type="text"
              className="gf-cl-input gf-num"
              placeholder="—"
              value={head.buyPrice}
              onChange={(e) => handleHead({ buyPrice: e.target.value })}
            />
            {buyHint && <div className="gf-cl-hint">{buyHint}</div>}
          </div>
          <div className="gf-cl-field">
            <label className="gf-cl-label">Giá bán dự kiến (₫)</label>
            <input
              type="text"
              className="gf-cl-input gf-num"
              placeholder="—"
              value={head.sellPrice}
              onChange={(e) => handleHead({ sellPrice: e.target.value })}
            />
            {sellHint && <div className="gf-cl-hint">{sellHint}</div>}
          </div>
          <div>
            <label className="gf-cl-label">Ngày bán dự kiến</label>
            <input
              type="date"
              className="gf-cl-input gf-num"
              value={head.sellDate}
              onChange={(e) => handleHead({ sellDate: e.target.value })}
            />
          </div>
        </div>

        {formError && <div className="gf-cl-error">{formError}</div>}
      </div>

      <CriteriaTable rows={rows} onStatus={handleStatus} onVal={handleVal} />
    </div>
  );
}
