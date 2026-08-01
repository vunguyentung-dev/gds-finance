import type { Quote } from '../../api/market';
import { toDong } from '../../lib/format';
import { formatSourceOnly, isDimmed, stalePrefix, staleTooltip } from '../../lib/price';

interface Props {
  sym: string;
  quote: Quote | null;
  loading: boolean;
}

/**
 * Giá trong SỔ CỦA MÌNH, đặt ngay dưới biểu đồ TradingView.
 *
 * Đây là khối quan trọng nhất của màn này, không phải khối trang trí: biểu đồ dùng dữ
 * liệu TradingView, còn lãi/lỗ ở màn Giao dịch và Tổng quan dùng giá lưu trong
 * fin_quote_history. HAI NGUỒN KHÁC NHAU và có thể lệch nhau. Không nói rõ thì người
 * dùng sẽ đọc số trên biểu đồ rồi tưởng lãi/lỗ của mình được tính theo số đó.
 */
export function OwnPriceStrip({ sym, quote, loading }: Props) {
  return (
    <div className="gf-an-own">
      <div className="gf-an-own-head">
        <div className="gf-an-own-title">Giá trong sổ của bạn</div>
        <div className="gf-an-own-sub">
          Đây mới là giá dùng để tính lãi/lỗ ở màn Giao dịch và Tổng quan. Biểu đồ phía trên là dữ liệu của
          TradingView — <b>hai nguồn khác nhau, có thể lệch nhau</b>.
        </div>
      </div>

      {loading ? (
        <div className="gf-an-own-msg">Đang đọc giá của {sym}…</div>
      ) : quote === null ? (
        <div className="gf-an-own-msg">
          <b>Chưa có giá cho {sym} trong sổ.</b> Biểu đồ vẫn xem được, nhưng lãi/lỗ của mã này chưa tính ra số. Nhập
          giá ở màn <b>Bảng giá</b>.
        </div>
      ) : (
        <div className="gf-an-own-grid gf-num">
          <Cell
            label="Khớp (đóng cửa)"
            value={`${stalePrefix(quote.staleness)}${toDong(Number(quote.close_price))}`}
            title={staleTooltip(quote)}
            strong
          />
          <Cell label="TC phiên trước" value={quote.prev_close ? toDong(Number(quote.prev_close)) : '—'} />
          <Cell
            label="Trần / Sàn phiên kế tiếp"
            value={
              quote.next_band
                ? `${toDong(Number(quote.next_band.ceiling))} / ${toDong(Number(quote.next_band.floor))}`
                : '—'
            }
            title={
              quote.next_band
                ? `Sàn ${quote.next_band.exchange}, biên ${quote.next_band.band_pct}%, bước giá ${toDong(Number(quote.next_band.tick))} ₫`
                : 'Chưa biết sàn hoặc chưa có giá tham chiếu'
            }
          />
          {/* Mục 9.1: không được hiện giá mà giấu nguồn */}
          <Cell
            label="Nguồn giá trong sổ"
            value={formatSourceOnly(quote)}
            dim={isDimmed(quote.staleness)}
            title={staleTooltip(quote)}
          />
        </div>
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  title,
  strong,
  dim,
}: {
  label: string;
  value: string;
  title?: string;
  strong?: boolean;
  dim?: boolean;
}) {
  return (
    <div className="gf-an-cell" title={title}>
      <div className="gf-an-cell-label">{label}</div>
      <div className={`gf-an-cell-val${strong ? ' strong' : ''}${dim ? ' dim' : ''}`}>{value}</div>
    </div>
  );
}
