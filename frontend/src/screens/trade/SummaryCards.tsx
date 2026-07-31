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
}

export function SummaryCards({ cards }: Props) {
  const realized = Number(cards.total_realized);
  const pct = cards.total_realized_pct === null ? null : Number(cards.total_realized_pct);

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
