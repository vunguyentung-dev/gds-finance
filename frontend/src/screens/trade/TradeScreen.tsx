import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import {
  createStockTxn,
  getRates,
  getStockSummary,
  getStockTxns,
  voidStockTxn,
  type RateTier,
  type StockSummary,
  type StockTxn,
  type TxnType,
} from '../../api/stock';
import { parseVNNumber, todayIso } from '../../lib/format';
import { SummaryCards } from './SummaryCards';
import { TxnForm, type TxnDraft } from './TxnForm';
import { BySymTable } from './BySymTable';
import { FlowTable } from './FlowTable';
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

  const load = useCallback((ignore: { current: boolean }) => {
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
  }, []);

  const handleSideChange = (side: TxnType) => setDraft((d) => ({ ...d, side }));

  const handleFieldChange = (key: 'sym' | 'date' | 'qty' | 'price', value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
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

    setSubmitting(true);
    setFormError('');
    try {
      await createStockTxn({
        sym,
        txn_type: draft.side,
        txn_date: draft.date,
        qty: String(Math.round(qty)),
        price: String(priceDong),
      });
      setDraft((d) => ({ ...d, sym: '', qty: '', price: '' }));
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
      <SummaryCards cards={summary.cards} />

      <TxnForm
        draft={draft}
        currentRate={currentRateOf(rates)}
        submitting={submitting}
        error={formError}
        onSideChange={handleSideChange}
        onFieldChange={handleFieldChange}
        onSubmit={handleSubmit}
      />

      <BySymTable rows={summary.by_sym} />
      <FlowTable rows={summary.flow} footer={summary.footer} />
      <TxnLogTable rows={txns} onVoid={handleVoid} />

      <div className="gf-trade-note">
        Lãi/lỗ thực hiện = tiền bán ròng (sau phí bán + thuế) − giá vốn bình quân của phần đã bán (giá mua đã gồm phí
        mua). Mã chưa bán chưa phát sinh lãi/lỗ. Xoá giao dịch là đánh dấu bỏ ghi, dữ liệu vẫn được giữ để kiểm toán.
      </div>
    </div>
  );
}
