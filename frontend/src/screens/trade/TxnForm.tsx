import type { RateTier, TxnType } from '../../api/stock';
import { describeDong, formatVN, parseVNNumber } from '../../lib/format';

export interface TxnDraft {
  sym: string;
  side: TxnType;
  date: string;
  qty: string;
  price: string;
}

type DraftField = 'sym' | 'date' | 'qty' | 'price';

interface Props {
  draft: TxnDraft;
  /** Khối chọn lô, chỉ dựng cho lệnh BÁN (api-spec 7.11). */
  lotPicker: React.ReactNode;
  /** Mốc phí đang hiệu lực, để hiện chú thích như prototype (dòng 1466). */
  currentRate: RateTier | null;
  submitting: boolean;
  error: string;
  onSideChange: (side: TxnType) => void;
  onFieldChange: (key: DraftField, value: string) => void;
  onSubmit: () => void;
}

export function TxnForm({
  draft,
  lotPicker,
  currentRate,
  submitting,
  error,
  onSideChange,
  onFieldChange,
  onSubmit,
}: Props) {
  // Diễn giải giá vừa gõ để soát số 0 — ô này nhập theo ĐỒNG/cp
  const priceHint = describeDong(parseVNNumber(draft.price));
  const feeNote = currentRate
    ? `Phí mua/bán ${formatVN(Number(currentRate.buy_fee), 2)}% · thuế bán ${formatVN(Number(currentRate.tax), 2)}% (hiện hành).`
    : '';

  return (
    <div className="gf-trade-panel">
      <div className="gf-trade-panel-title">Nhập giao dịch mới</div>
      <div className="gf-trade-panel-sub">
        Giá tính bằng đồng/cổ phiếu. {feeNote} Lãi/lỗ tính theo giá vốn bình quân, áp dụng biểu phí theo ngày giao dịch.
      </div>

      <div className="gf-trade-form">
        <div>
          <label className="gf-trade-label">Mã CP</label>
          <input
            type="text"
            className="gf-trade-input sym"
            placeholder="VD: FPT"
            value={draft.sym}
            onChange={(e) => onFieldChange('sym', e.target.value)}
          />
        </div>

        <div>
          <label className="gf-trade-label">Loại giao dịch</label>
          <div className="gf-trade-side">
            <button
              type="button"
              className={`gf-trade-side-btn${draft.side === 'buy' ? ' on-buy' : ''}`}
              onClick={() => onSideChange('buy')}
            >
              MUA
            </button>
            <button
              type="button"
              className={`gf-trade-side-btn${draft.side === 'sell' ? ' on-sell' : ''}`}
              onClick={() => onSideChange('sell')}
            >
              BÁN
            </button>
          </div>
        </div>

        <div>
          <label className="gf-trade-label">Ngày thực hiện</label>
          <input
            type="date"
            className="gf-trade-input gf-num"
            value={draft.date}
            onChange={(e) => onFieldChange('date', e.target.value)}
          />
        </div>

        <div>
          <label className="gf-trade-label">Khối lượng</label>
          <input
            type="text"
            className="gf-trade-input gf-num"
            placeholder="1.000"
            value={draft.qty}
            onChange={(e) => onFieldChange('qty', e.target.value)}
          />
        </div>

        <div className="gf-trade-price-cell">
          <label className="gf-trade-label">Giá {draft.side === 'buy' ? 'mua' : 'bán'} (₫/cp)</label>
          <input
            type="text"
            className="gf-trade-input gf-num"
            placeholder="98.500"
            value={draft.price}
            onChange={(e) => onFieldChange('price', e.target.value)}
          />
          {priceHint && <div className="gf-trade-price-hint">{priceHint}</div>}
        </div>

        <button type="button" className="gf-trade-submit" onClick={onSubmit} disabled={submitting}>
          + Thêm
        </button>
      </div>

      {draft.side === 'sell' && lotPicker}

      {error && <div className="gf-trade-error">{error}</div>}
    </div>
  );
}
