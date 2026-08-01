import type { AvailableLots } from '../../api/stock';
import { formatDateVN, toDong, toQty } from '../../lib/format';
import { autoPreview } from './lotAlloc';

export type LotMode = 'auto' | 'manual';

interface Props {
  data: AvailableLots | null;
  loading: boolean;
  error: string;
  /** Khối lượng đang gõ ở form. 0 = chưa gõ. */
  sellQty: number;
  mode: LotMode;
  /** buy_txn_id -> số cp user ghim (chuỗi thô đang gõ). */
  pins: Record<string, string>;
  onModeChange: (mode: LotMode) => void;
  onPinChange: (buyTxnId: string, value: string) => void;
  onFillAuto: () => void;
}

function sumPins(pins: Record<string, string>): number {
  return Object.values(pins).reduce((acc, v) => acc + (Number(v.replace(/\D/g, '')) || 0), 0);
}

/**
 * Chọn lô thủ công cho lệnh BÁN — api-spec mục 7.11.
 *
 * Luôn hiện phân bổ tự động trước, kể cả ở chế độ ghim tay: user cần thấy "hệ thống
 * sẽ chọn lô nào" để biết mình đang ghim khác đi ở đâu, chứ không chọn trong bóng tối.
 */
export function LotPicker({
  data,
  loading,
  error,
  sellQty,
  mode,
  pins,
  onModeChange,
  onPinChange,
  onFillAuto,
}: Props) {
  if (loading) {
    return <div className="gf-pick gf-pick-msg">Đang xem các lô còn hàng…</div>;
  }
  if (error !== '') {
    return <div className="gf-pick gf-pick-msg err">Không đọc được danh sách lô: {error}</div>;
  }
  if (data === null) {
    return <div className="gf-pick gf-pick-msg">Nhập mã CP và ngày để xem các lô có thể bán.</div>;
  }

  const lots = data.lots;
  const leftTotal = Number(data.qty_left_total);

  if (lots.length === 0) {
    return (
      <div className="gf-pick gf-pick-msg err">
        Không còn lô <b>{data.sym}</b> nào chưa khớp tính đến {formatDateVN(data.on)}. Lệnh bán vẫn ghi được, nhưng sẽ
        không khớp vào lô nào — xem cảnh báo “bán vượt” ở panel chi tiết lô sau khi thêm.
      </div>
    );
  }

  const preview = autoPreview(lots, sellQty);
  const pinned = sumPins(pins);
  const shortfall = sellQty - pinned;

  return (
    <div className="gf-pick">
      <div className="gf-pick-head">
        <div>
          <div className="gf-pick-title">Khớp lô cho lệnh bán này</div>
          <div className="gf-pick-sub">
            Còn <b className="gf-num">{toQty(leftTotal)}</b> cp {data.sym} chưa khớp, tính đến {formatDateVN(data.on)}.
            Thứ tự dưới đây là thứ tự <b>engine C</b> sẽ tự chọn: giá vốn thấp nhất trước.
          </div>
        </div>
        <div className="gf-pick-modes">
          <button
            type="button"
            className={`gf-pick-mode${mode === 'auto' ? ' on' : ''}`}
            onClick={() => onModeChange('auto')}
          >
            Tự động
          </button>
          <button
            type="button"
            className={`gf-pick-mode${mode === 'manual' ? ' on' : ''}`}
            onClick={() => onModeChange('manual')}
          >
            Ghim tay
          </button>
        </div>
      </div>

      <table className="gf-trade-table gf-num gf-pick-table">
        <thead>
          <tr>
            <th className="l">Lô mua</th>
            <th>Giá mua</th>
            <th>Giá vốn/cp</th>
            <th>Còn chưa khớp</th>
            <th>{mode === 'auto' ? 'Tự động lấy' : 'Ghim bao nhiêu'}</th>
          </tr>
        </thead>
        <tbody>
          {lots.map((l, i) => {
            const auto = preview[l.buy_txn_id] ?? 0;
            const partly = Number(l.qty_matched) > 0;
            return (
              <tr key={l.buy_txn_id} className={mode === 'auto' && auto > 0 ? 'gf-pick-auto-row' : undefined}>
                <td className="l">
                  <div className="gf-lot-lotline">
                    <span className="gf-lot-order">{i + 1}</span>
                    <span className="date">{formatDateVN(l.buy_date)}</span>
                    {!l.settled && (
                      <span className="gf-lot-tag unsettled" title={`Hàng về ${formatDateVN(l.settle_date)}`}>
                        chưa về
                      </span>
                    )}
                    {partly && (
                      <span
                        className="gf-lot-tag unsettled"
                        title={`Lô ${toQty(Number(l.qty_total))} cp, đã bị khớp ${toQty(Number(l.qty_matched))} cp`}
                      >
                        đã khớp {toQty(Number(l.qty_matched))}
                      </span>
                    )}
                  </div>
                </td>
                <td className="muted">{toDong(Number(l.buy_price))}</td>
                <td>{toDong(Number(l.unit_cost))}</td>
                <td className="muted">{toQty(Number(l.qty_left))}</td>
                <td>
                  {mode === 'auto' ? (
                    auto > 0 ? (
                      <b>{toQty(auto)}</b>
                    ) : (
                      <span className="gf-pick-zero">—</span>
                    )
                  ) : (
                    <input
                      type="text"
                      className="gf-pick-input gf-num"
                      placeholder="0"
                      value={pins[l.buy_txn_id] ?? ''}
                      onChange={(e) => onPinChange(l.buy_txn_id, e.target.value)}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {mode === 'auto' ? (
        <div className="gf-pick-foot">
          {sellQty <= 0 ? (
            <span>Gõ khối lượng để xem hệ thống sẽ lấy từ lô nào.</span>
          ) : sellQty > leftTotal ? (
            <span className="warn">
              ⚠ Bán {toQty(sellQty)} cp nhưng chỉ còn {toQty(leftTotal)} cp chưa khớp — phần thiếu{' '}
              {toQty(sellQty - leftTotal)} cp sẽ không khớp vào lô nào.
            </span>
          ) : (
            <span>
              Hệ thống sẽ khớp đủ {toQty(sellQty)} cp theo thứ tự trên. Bấm <b>Ghim tay</b> nếu muốn chọn lô khác.
            </span>
          )}
        </div>
      ) : (
        <div className="gf-pick-foot">
          <div className="gf-pick-tally">
            <span>
              Đã ghim <b className="gf-num">{toQty(pinned)}</b> / {toQty(sellQty)} cp
            </span>
            {sellQty > 0 && shortfall !== 0 && (
              <span className="warn">
                {shortfall > 0
                  ? `còn thiếu ${toQty(shortfall)} cp`
                  : `thừa ${toQty(-shortfall)} cp`}
              </span>
            )}
            {sellQty > 0 && shortfall === 0 && <span className="ok">✓ khớp đủ</span>}
          </div>
          <button type="button" className="gf-pick-fill" onClick={onFillAuto} disabled={sellQty <= 0}>
            Điền như tự động
          </button>
        </div>
      )}

      <div className="gf-pick-note">
        {mode === 'auto'
          ? 'Khớp lô rẻ nhất trước làm sổ đã chốt đẹp lên và để lô giá cao ở lại danh mục — chênh lệch chuyển sang phần còn nắm, không mất đi.'
          : 'Tổng ghim phải ĐÚNG BẰNG khối lượng bán: thiếu hay thừa đều bị từ chối, hệ thống không tự bù phần còn lại. Lô đã ghim tay sẽ không bị khớp lại khi thêm lệnh lùi ngày.'}
      </div>
    </div>
  );
}
