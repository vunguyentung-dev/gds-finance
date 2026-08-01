import type { FlowRow, SummaryFooter } from '../../api/stock';
import { formatDateVN, signedDong, toDong, toQty } from '../../lib/format';

interface Props {
  rows: FlowRow[];
  footer: SummaryFooter;
  /** Lệnh bán đang mở panel chi tiết lô (engine C), null = chưa mở. */
  openLotsId: string | null;
  onToggleLots: (id: string) => void;
}

function t2Label(r: FlowRow): { text: string; color: string } {
  if (r.t2_state === 'settled_future') {
    return { text: `Hàng về ${r.settle_date ? formatDateVN(r.settle_date) : '—'}`, color: 'var(--muted)' };
  }
  if (r.t2_state === 'short') {
    return { text: `⚠ Chỉ ${toQty(Number(r.t2_avail ?? '0'))} cp đã về (T+2)`, color: 'var(--down)' };
  }
  return { text: '✓ Hàng đã về', color: 'var(--up)' };
}

/** Bảng "Diễn tiến giao dịch theo T+2" — số liệu từ engine FIFO. */
export function FlowTable({ rows, footer, openLotsId, onToggleLots }: Props) {
  const remain = Number(footer.flow_remain);
  const cumPl = Number(footer.cum_pl);
  const diff = Number(footer.engines_diff);

  return (
    <div className="gf-trade-table-wrap">
      <div className="gf-trade-table-head">
        <div className="gf-trade-panel-title">Diễn tiến giao dịch theo T+2</div>
        <div className="gf-trade-table-sub">
          Cổ phiếu chỉ bán được sau khi hàng về (T+2). Lãi/lỗ khớp theo <b>FIFO</b> (engine B), lũy kế đến khi bán
          sạch. Bấm <b>lô</b> ở cuối một lệnh bán để xem cách khớp của <b>engine C</b> — số sẽ khác, đó là thiết kế.
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="gf-trade-empty">Chưa có giao dịch nào.</div>
      ) : (
        <>
          <table className="gf-trade-table gf-num">
            <thead>
              <tr>
                <th className="l">Ngày</th>
                <th className="l">Mã</th>
                <th className="l">Loại</th>
                <th>KL</th>
                <th>Giá</th>
                <th className="l">Trạng thái T+2</th>
                <th>Dòng tiền ròng</th>
                <th>Lãi/lỗ dòng</th>
                <th>Lũy kế</th>
                <th>Còn nắm</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isBuy = r.txn_type === 'buy';
                const t2 = t2Label(r);
                const cash = Number(r.cash);
                const rowPl = r.row_pl === null ? null : Number(r.row_pl);
                const cum = Number(r.cum_pl);
                return (
                  <tr key={r.id}>
                    <td className="l date">{formatDateVN(r.txn_date)}</td>
                    <td className="l">
                      <b>{r.sym}</b>
                    </td>
                    <td className="l">
                      <span className={`gf-trade-badge ${isBuy ? 'buy' : 'sell'}`}>{isBuy ? 'MUA' : 'BÁN'}</span>
                    </td>
                    <td className="muted">{toQty(Number(r.qty))}</td>
                    <td>{toDong(Number(r.price))}</td>
                    <td className="l gf-trade-t2" style={{ color: t2.color, fontFamily: 'Manrope' }}>
                      {t2.text}
                    </td>
                    <td style={{ color: cash >= 0 ? 'var(--up)' : 'var(--fg)' }}>{signedDong(cash)}</td>
                    <td
                      className="strong"
                      style={{ color: rowPl === null ? 'var(--muted2)' : rowPl >= 0 ? 'var(--up)' : 'var(--down)' }}
                    >
                      {rowPl === null ? '—' : signedDong(rowPl)}
                    </td>
                    <td className="bold" style={{ color: cum >= 0 ? 'var(--up)' : 'var(--down)' }}>
                      {signedDong(cum)}
                    </td>
                    <td className="muted">{toQty(Number(r.remain))} cp</td>
                    <td className="gf-trade-lots-cell">
                      {isBuy ? null : (
                        <button
                          type="button"
                          className={`gf-trade-lots-btn${openLotsId === r.id ? ' on' : ''}`}
                          onClick={() => onToggleLots(r.id)}
                          title="Xem lệnh bán này ăn vào lô mua nào (engine C)"
                        >
                          lô{openLotsId === r.id ? ' ▾' : ' ▸'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="gf-trade-foot">
            <div className="gf-trade-foot-label">
              {remain <= 0
                ? 'Đã bán sạch — lãi/lỗ cuối cùng'
                : `Còn nắm ${toQty(remain)} cp — lãi/lỗ đã chốt`}
            </div>
            <div className="gf-trade-foot-num gf-num" style={{ color: cumPl >= 0 ? 'var(--up)' : 'var(--down)' }}>
              {signedDong(cumPl)}
            </div>
          </div>

          {footer.engines_diverge && (
            <div className="gf-trade-diverge">
              <span>⚠</span>
              <div>
                <b>Hai cách tính đang lệch nhau {toDong(Math.abs(diff))}.</b> Số ở chân bảng này (
                {signedDong(cumPl)}) khớp lô theo <b>FIFO</b>, còn thẻ “Tổng lãi/lỗ đã thực hiện” đầu màn (
                {signedDong(Number(footer.total_realized))}) dùng <b>giá vốn bình quân</b>. Chênh lệch phát sinh
                khi có nhiều lô mua khác giá hoặc lệnh bán vượt số hàng đã về.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
