import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import {
  createStockTxn,
  getAvailableLots,
  getLotDetail,
  getRates,
  getStockSummary,
  getStockTxns,
  voidStockTxn,
  type AvailableLots,
  type LotDetail as LotDetailData,
  type LotMatchInput,
  type RateTier,
  type StockSummary,
  type StockTxn,
  type TxnType,
} from '../../api/stock';
import { getInvested, type Invested } from '../../api/finance';
import { parseVNNumber, todayIso } from '../../lib/format';
import { SummaryCards } from './SummaryCards';
import { TxnForm, type TxnDraft } from './TxnForm';
import { BySymTable } from './BySymTable';
import { FlowTable } from './FlowTable';
import { LotDetail } from './LotDetail';
import { LotPicker, type LotMode } from './LotPicker';
import { autoPreview } from './lotAlloc';
import { TxnLogTable } from './TxnLogTable';
import '../../styles/trade.css';

type ScreenState = 'loading' | 'ready' | 'error' | 'forbidden';

function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Đã xảy ra lỗi.';
}

/** Mốc phí đang hiệu lực hôm nay = mốc cuối cùng có eff_date <= hôm nay. */
function currentRateOf(rates: RateTier[]): RateTier | null {
  const today = todayIso();
  let cur: RateTier | null = rates[0] ?? null;
  for (const r of rates) {
    if (r.eff_date <= today) cur = r;
  }
  return cur;
}

export function TradeScreen() {
  const [state, setState] = useState<ScreenState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [txns, setTxns] = useState<StockTxn[] | null>(null);
  const [rates, setRates] = useState<RateTier[]>([]);

  const [draft, setDraft] = useState<TxnDraft>({
    sym: '',
    side: 'buy',
    date: todayIso(),
    qty: '',
    price: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // --- engine C: panel chi tiết lô của một lệnh bán ---
  const [lotsId, setLotsId] = useState<string | null>(null);
  const [lots, setLots] = useState<LotDetailData | null>(null);
  const [lotsLoading, setLotsLoading] = useState(false);
  const [lotsError, setLotsError] = useState('');
  const [lotsReload, setLotsReload] = useState(0);

  // --- engine C: chọn lô cho lệnh BÁN sắp thêm ---
  const [avail, setAvail] = useState<AvailableLots | null>(null);
  const [availLoading, setAvailLoading] = useState(false);
  const [availError, setAvailError] = useState('');
  const [lotMode, setLotMode] = useState<LotMode>('auto');
  const [pins, setPins] = useState<Record<string, string>>({});

  // Vốn user tự khai ở màn Tài chính cá nhân. null = chưa đọc được.
  const [invested, setInvested] = useState<Invested | null>(null);

  const load = useCallback((ignore: { current: boolean }) => {
    // Đọc riêng, ngoài Promise.all: fin/invested thuộc màn Tài chính cá nhân, không
    // phải nguồn số của màn này. Nó lỗi thì mất một thẻ, không được làm sập cả màn
    // Giao dịch — và nó là endpoint mới, có thể chưa được áp ở backend.
    getInvested().then(
      (inv) => {
        if (!ignore.current) setInvested(inv);
      },
      () => {
        /* giữ null: thẻ Vốn thực có hiện — */
      },
    );

    Promise.all([getStockSummary(), getStockTxns(), getRates()]).then(
      ([sum, list, rs]) => {
        if (ignore.current) return;
        setSummary(sum);
        setTxns(list);
        setRates(rs);
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
    const [sum, list] = await Promise.all([getStockSummary(), getStockTxns()]);
    setSummary(sum);
    setTxns(list);
    // Thêm/void một lệnh có thể khiến engine C khớp lại các lô (api-spec 7.7), nên
    // panel đang mở là số cũ. Nạp lại thay vì để user nhìn số đã lỗi thời. Không bật
    // cờ loading ở đây: giữ số cũ trong lúc nạp đỡ nháy hơn là thay bằng spinner.
    setLotsReload((n) => n + 1);
  }, []);

  // Danh sách lô còn hàng: chỉ hỏi khi đang nhập lệnh BÁN và đã có mã. Debounce vì
  // ô mã gõ từng chữ — không debounce thì mỗi ký tự là một request.
  const symKey = draft.side === 'sell' ? draft.sym.trim().toUpperCase() : '';
  const dateKey = draft.date;

  useEffect(() => {
    // Không dọn state ở đây: setState đồng bộ trong effect bị eslint chặn, và việc
    // dọn thuộc về hành vi đổi mã/ngày (resetPins) chứ không thuộc về việc nạp.
    if (symKey.length < 3 || dateKey === '') return;
    const ignore = { current: false };
    const timer = window.setTimeout(() => {
      setAvailLoading(true);
      getAvailableLots(symKey, dateKey).then(
        (d) => {
          if (ignore.current) return;
          setAvail(d);
          setAvailError('');
          setAvailLoading(false);
        },
        (err) => {
          if (ignore.current) return;
          setAvail(null);
          setAvailError(errorMessageOf(err));
          setAvailLoading(false);
        },
      );
    }, 350);
    return () => {
      ignore.current = true;
      window.clearTimeout(timer);
    };
  }, [symKey, dateKey, lotsReload]);

  // Chi tiết lô nạp riêng, KHÔNG gộp vào load() đầu màn: nó là dữ liệu của một lệnh
  // cụ thể, tải hết mọi lệnh bán ngay từ đầu là N request cho thứ user chưa mở.
  useEffect(() => {
    if (lotsId === null) return;
    // KHÔNG setState đồng bộ trong effect (eslint react-hooks/set-state-in-effect):
    // cờ loading do chính hành vi mở panel / bấm Thử lại đặt, effect chỉ ghi kết quả.
    const ignore = { current: false };
    getLotDetail(lotsId).then(
      (d) => {
        if (ignore.current) return;
        setLots(d);
        setLotsLoading(false);
      },
      (err) => {
        if (ignore.current) return;
        setLots(null);
        setLotsError(errorMessageOf(err));
        setLotsLoading(false);
      },
    );
    return () => {
      ignore.current = true;
    };
  }, [lotsId, lotsReload]);

  const handleToggleLots = (id: string) => {
    if (lotsId === id) {
      setLotsId(null);
      return;
    }
    setLotsId(id);
    setLots(null);
    setLotsError('');
    setLotsLoading(true);
  };

  const handleRetryLots = () => {
    setLotsError('');
    setLotsLoading(true);
    setLotsReload((n) => n + 1);
  };

  // Đổi mã / ngày / loại lệnh thì các lô đã ghim không còn nghĩa gì — xoá, không
  // giữ lại số cũ để tránh ghim vào lô của mã khác.
  const resetPins = () => {
    setPins({});
    setLotMode('auto');
    setAvail(null);
    setAvailError('');
  };

  const handleSideChange = (side: TxnType) => {
    setDraft((d) => ({ ...d, side }));
    resetPins();
  };

  const handleFieldChange = (key: 'sym' | 'date' | 'qty' | 'price', value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (key === 'sym' || key === 'date') resetPins();
  };

  const handlePinChange = (buyTxnId: string, value: string) => {
    const digits = value.replace(/\D/g, '');
    setPins((p) => ({ ...p, [buyTxnId]: digits }));
  };

  const handleFillAuto = () => {
    const qty = Math.round(parseVNNumber(draft.qty));
    if (!avail || qty <= 0) return;
    const preview = autoPreview(avail.lots, qty);
    const next: Record<string, string> = {};
    for (const [id, n] of Object.entries(preview)) next[id] = String(n);
    setPins(next);
  };

  const handleSubmit = async () => {
    const sym = draft.sym.trim().toUpperCase();
    const qty = parseVNNumber(draft.qty);
    // Ô nhập theo ĐỒNG/cp — gửi thẳng, không quy đổi. DB cũng lưu theo đồng/cp.
    const priceDong = parseVNNumber(draft.price);

    if (!sym || !qty || !priceDong || !draft.date) {
      setFormError('Cần nhập đủ mã CP, ngày, khối lượng và giá.');
      return;
    }

    const qtyInt = Math.round(qty);

    // Ghim tay: kiểm Σ ngay tại client để user sửa được liền. Backend vẫn kiểm lại
    // và trả 400 — đây là lớp tiện dụng, KHÔNG phải lớp bảo đảm.
    let lotMatches: LotMatchInput[] | undefined;
    if (draft.side === 'sell' && lotMode === 'manual') {
      lotMatches = Object.entries(pins)
        .map(([buy_txn_id, v]) => ({ buy_txn_id, qty: v }))
        .filter((m) => Number(m.qty) > 0);
      if (lotMatches.length === 0) {
        setFormError('Đang ở chế độ ghim tay nhưng chưa ghim lô nào. Nhập số cp cho ít nhất một lô, hoặc chuyển về Tự động.');
        return;
      }
      const pinned = lotMatches.reduce((acc, m) => acc + Number(m.qty), 0);
      if (pinned !== qtyInt) {
        setFormError(
          `Tổng ghim ${pinned} cp không bằng khối lượng bán ${qtyInt} cp. Sửa cho khớp — hệ thống không tự bù phần còn lại.`,
        );
        return;
      }
    }

    setSubmitting(true);
    setFormError('');
    try {
      await createStockTxn({
        sym,
        txn_type: draft.side,
        txn_date: draft.date,
        qty: String(qtyInt),
        price: String(priceDong),
        ...(lotMatches ? { lot_matches: lotMatches } : {}),
      });
      setDraft((d) => ({ ...d, sym: '', qty: '', price: '' }));
      resetPins();
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
      await voidStockTxn(id);
      await refresh();
    } catch (err) {
      setFormError(errorMessageOf(err));
    }
  };

  if (state === 'loading') {
    return (
      <div className="gf-trade-state">
        <div className="gf-trade-state-title">Đang tải dữ liệu…</div>
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div className="gf-trade-state">
        <div className="gf-trade-state-title">Bạn không có quyền truy cập màn này.</div>
        <div>Vui lòng liên hệ quản trị viên để được cấp quyền.</div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="gf-trade-state">
        <div className="gf-trade-state-title">Không tải được dữ liệu.</div>
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

  if (!summary || !txns) return null;

  return (
    <div className="gf-trade">
      <SummaryCards cards={summary.cards} invested={invested} />

      <TxnForm
        draft={draft}
        lotPicker={
          <LotPicker
            data={avail}
            // Suy ra, không thêm state: vừa đổi mã thì avail đã bị dọn nhưng request
            // debounce chưa chạy — vẫn phải hiện "đang xem", không hiện "nhập mã".
            loading={availLoading || (symKey.length >= 3 && avail === null && availError === '')}
            error={availError}
            sellQty={Math.round(parseVNNumber(draft.qty))}
            mode={lotMode}
            pins={pins}
            onModeChange={setLotMode}
            onPinChange={handlePinChange}
            onFillAuto={handleFillAuto}
          />
        }
        currentRate={currentRateOf(rates)}
        submitting={submitting}
        error={formError}
        onSideChange={handleSideChange}
        onFieldChange={handleFieldChange}
        onSubmit={handleSubmit}
      />

      <BySymTable rows={summary.by_sym} />
      <FlowTable
        rows={summary.flow}
        footer={summary.footer}
        openLotsId={lotsId}
        onToggleLots={handleToggleLots}
      />

      {lotsId !== null && (
        <LotDetail
          detail={lots}
          loading={lotsLoading}
          error={lotsError}
          engineBPl={summary.flow.find((f) => f.id === lotsId)?.row_pl ?? null}
          onClose={() => setLotsId(null)}
          onRetry={handleRetryLots}
        />
      )}

      <TxnLogTable rows={txns} onVoid={handleVoid} />

      <div className="gf-trade-note">
        Lãi/lỗ thực hiện = tiền bán ròng (sau phí bán + thuế) − giá vốn bình quân của phần đã bán (giá mua đã gồm phí
        mua). Mã chưa bán chưa phát sinh lãi/lỗ. Xoá giao dịch là đánh dấu bỏ ghi, dữ liệu vẫn được giữ để kiểm toán.
        Không void được lệnh mua khi vẫn có lệnh bán khớp vào nó — void lệnh bán trước.
      </div>
    </div>
  );
}
