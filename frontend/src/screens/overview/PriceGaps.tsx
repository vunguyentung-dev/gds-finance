import type { QuoteGaps } from '../../api/overview';
import { describeDong, formatDateVN, parseVNNumber, toDong, toQty } from '../../lib/format';

interface Props {
  gaps: QuoteGaps;
  drafts: Record<string, string>;
  saving: boolean;
  error: string;
  okMessage: string;
  onChange: (sym: string, value: string) => void;
  onSubmit: () => void;
}

/**
 * Nhập giá đóng cửa bù cho các mã còn thiếu — mục 8.11.
 * Khối này không có trong prototype gốc, nhưng nếu thiếu thì mọi số phụ thuộc giá
 * sẽ đứng ở "—" mãi mà người dùng không có cách nào sửa.
 */
export function PriceGaps({ gaps, drafts, saving, error, okMessage, onChange, onSubmit }: Props) {
  const hasInput = Object.values(drafts).some((v) => parseVNNumber(v) > 0);

  return (
    <div className="gf-ov-panel">
      <div className="gf-ov-panel-title">Nhập giá đóng cửa còn thiếu</div>
      <div className="gf-ov-panel-sub">
        Phiên gần nhất: <b>{formatDateVN(gaps.last_trading_day)}</b>. Giá tính bằng đồng/cổ phiếu. Giá tự động sẽ
        không ghi đè giá bạn nhập tay.
      </div>

      {gaps.missing.map((g) => {
        const v = drafts[g.sym] ?? '';
        const hint = describeDong(parseVNNumber(v));
        return (
          <div key={g.sym} className="gf-ov-gaprow">
            <div className="gf-ov-sym">{g.sym}</div>
            <div>
              <label className="gf-ov-label">Giá đóng cửa (₫/cp) · KL {toQty(Number(g.qty))}</label>
              <input
                type="text"
                className="gf-ov-input gf-num"
                placeholder="19.100"
                value={v}
                onChange={(e) => onChange(g.sym, e.target.value)}
              />
            </div>
            <div className="gf-ov-hint">
              {hint ? (
                hint
              ) : g.last_known ? (
                <>
                  Giá gần nhất đã biết: {toDong(Number(g.last_known.close))} ({formatDateVN(g.last_known.trade_date)})
                </>
              ) : (
                'Chưa có giá nào cho mã này'
              )}
            </div>
          </div>
        );
      })}

      <button type="button" className="gf-ov-btn" onClick={onSubmit} disabled={saving || !hasInput}>
        Lưu giá
      </button>

      {error && <div className="gf-ov-error">{error}</div>}
      {okMessage && <div className="gf-ov-ok">{okMessage}</div>}
    </div>
  );
}
