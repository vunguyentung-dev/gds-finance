import type { Invested } from '../../api/finance';
import type { SummaryCards as Cards } from '../../api/stock';
import { formatVN, signedDong, toDong } from '../../lib/format';

/**
 * Màu số lãi/lỗ trên thẻ hero: vàng khi hòa vốn, xanh khi lãi, đỏ khi lỗ.
 * Dùng biến thể sáng để tương phản trên nền --heroBg (gốc dòng 1489).
 */
function realizedColor(v: number): string {
  if (Math.abs(v) < 0.0001) return 'oklch(0.85 0.16 90)';
  return v > 0 ? 'oklch(0.85 0.18 150)' : 'oklch(0.72 0.18 25)';
}

interface Props {
  cards: Cards;
  /**
   * Vốn nộp vào TK chứng khoán, từ fin/invested — CỘNG DỒN TOÀN BỘ lịch sử.
   * null = chưa đọc được (endpoint chưa có, hoặc lỗi mạng): hiện — chứ không hiện 0.
   * Số này KHÔNG do engine nào tính; nó là tiền user tự khai ở màn Tài chính cá nhân.
   */
  invested: Invested | null;
}

export function SummaryCards({ cards, invested }: Props) {
  const realized = Number(cards.total_realized);
  const pct = cards.total_realized_pct === null ? null : Number(cards.total_realized_pct);
  // Phân biệt "chưa khai khoản đầu tư nào" với "không đọc được số" — hai lý do khác
  // nhau, cùng hiện — nhưng dòng phụ phải nói đúng cái nào.
  const invData =
    invested !== null && (Number(invested.in) > 0 || Number(invested.out) > 0) ? invested : null;

  return (
    <div className="gf-trade-cards">
      <div className="gf-trade-card gf-trade-hero">
        <div className="gf-trade-card-label">Tổng lãi/lỗ đã thực hiện</div>
        <div className="gf-trade-hero-num gf-num" style={{ color: realizedColor(realized) }}>
          {signedDong(realized)}
          {pct !== null && (
            <span className="gf-trade-hero-pct">
              {' '}
              {pct >= 0 ? '+' : ''}
              {formatVN(pct, 2)}%
            </span>
          )}
        </div>
        <div className="gf-trade-hero-foot">
          <div className="gf-trade-hero-row gf-num">
            <span>Tổng mua ròng</span>
            <b>{toDong(Number(cards.total_net_buy))}</b>
          </div>
          <div className="gf-trade-hero-row gf-num">
            <span>Tổng bán ròng</span>
            <b>{toDong(Number(cards.total_net_sell))}</b>
          </div>
        </div>
      </div>

      <div className="gf-trade-card gf-trade-card-cap">
        <div className="gf-trade-card-label">Vốn thực có</div>
        {invData !== null ? (
          <>
            <div className="gf-trade-card-num gf-num" style={{ color: 'var(--accent)' }}>
              {toDong(Number(invData.net))} ₫
            </div>
            <div className="gf-trade-card-sub gf-num">
              Đã nộp {toDong(Number(invData.in))} · đã rút {toDong(Number(invData.out))}
            </div>
          </>
        ) : (
          <>
            <div className="gf-trade-card-num gf-num">—</div>
            <div className="gf-trade-card-sub">
              {invested === null
                ? 'Chưa đọc được số vốn đã nộp.'
                : 'Chưa có khoản đầu tư nào. Nhập ở màn Tài chính cá nhân → Đầu tư.'}
            </div>
          </>
        )}
      </div>

      <div className="gf-trade-card">
        <div className="gf-trade-card-label">Số mã đang nắm giữ</div>
        <div className="gf-trade-card-num gf-num">{cards.held_count}</div>
      </div>

      <div className="gf-trade-card">
        <div className="gf-trade-card-label">Tổng phí + thuế</div>
        <div className="gf-trade-card-num gf-num">{toDong(Number(cards.total_fees))}</div>
      </div>
    </div>
  );
}
