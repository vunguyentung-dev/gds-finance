import { useState } from 'react';
import type { HistoryPoint, Indicator } from '../../api/market';
import { formatDateVN, toDong } from '../../lib/format';

interface Props {
  points: HistoryPoint[];
  ma20: Indicator;
  ma50: Indicator;
}

const W = 760;
const H = 300;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 22;

/**
 * Biểu đồ giá đóng cửa + MA, dựng từ fin_quote_history.
 *
 * KHÔNG nội suy phiên trống và không vẽ nến: bảng chỉ lưu GIÁ ĐÓNG CỬA, không có
 * mở/cao/thấp nên nến sẽ phải bịa ba trong bốn giá trị. Đường MA chỉ vẽ ở đoạn có đủ
 * phiên — phần đầu chuỗi để trống thay vì kéo ngang cho đẹp.
 */
export function PriceChart({ points, ma20, ma50 }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <div className="gf-ch-empty">
        <b>Chưa có giá nào trong sổ cho mã này.</b>
        <div>
          Biểu đồ dựng từ <code>fin_quote_history</code>. Nhập giá đóng cửa ở màn <b>Bảng giá</b> — mỗi phiên một điểm.
        </div>
      </div>
    );
  }

  const closes = points.map((p) => Number(p.close_price));
  const series = [closes, ma20.series.map((v) => (v === null ? null : Number(v)))];
  const ma50n = ma50.series.map((v) => (v === null ? null : Number(v)));
  const all = [...closes, ...series[1].filter((v): v is number => v !== null), ...ma50n.filter((v): v is number => v !== null)];

  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;

  const x = (i: number) =>
    points.length === 1 ? (W - PAD_L - PAD_R) / 2 + PAD_L : PAD_L + (i / (points.length - 1)) * (W - PAD_L - PAD_R);
  const y = (v: number) => H - PAD_B - ((v - min) / span) * (H - PAD_T - PAD_B);

  const path = (vals: (number | null)[]) => {
    // Mỗi đoạn liên tục là một lệnh M...L riêng, nên chỗ thiếu dữ liệu là KHOẢNG TRỐNG
    // thật, không phải một đường thẳng nối qua.
    const out: string[] = [];
    let open = false;
    vals.forEach((v, i) => {
      if (v === null) {
        open = false;
        return;
      }
      out.push(`${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
      open = true;
    });
    return out.join(' ');
  };

  const area = `M${x(0).toFixed(1)},${(H - PAD_B).toFixed(1)} ${closes
    .map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(' ')} L${x(points.length - 1).toFixed(1)},${(H - PAD_B).toFixed(1)} Z`;

  const hi = hover === null ? points.length - 1 : hover;
  const hp = points[hi];

  return (
    <div className="gf-ch">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="gf-ch-svg"
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const rel = ((e.clientX - box.left) / box.width) * W;
          const i = Math.round(((rel - PAD_L) / (W - PAD_L - PAD_R)) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
      >
        <defs>
          <linearGradient id="gf-ch-grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.20" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={area} fill="url(#gf-ch-grad)" />
        <path d={path(closes)} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
        {ma20.available && (
          <path d={path(series[1])} fill="none" stroke="var(--up)" strokeWidth="1.5" strokeDasharray="5 4" />
        )}
        {ma50.available && (
          <path d={path(ma50n)} fill="none" stroke="var(--down)" strokeWidth="1.5" strokeDasharray="2 4" />
        )}

        {/* Điểm thật: mỗi phiên một dấu, để thấy rõ chuỗi thưa hay dày */}
        {points.length <= 120 &&
          closes.map((v, i) => (
            <circle key={points[i].trade_date} cx={x(i)} cy={y(v)} r={i === hi ? 3.5 : 2} fill="var(--accent)" />
          ))}

        <line x1={x(hi)} y1={PAD_T} x2={x(hi)} y2={H - PAD_B} stroke="var(--border)" strokeWidth="1" />
      </svg>

      <div className="gf-ch-legend">
        <span className="gf-ch-key">
          <i className="line" /> Giá đóng cửa
        </span>
        <span className={`gf-ch-key${ma20.available ? '' : ' off'}`}>
          <i className="ma20" /> MA20 {ma20.available ? '' : '(chưa đủ phiên)'}
        </span>
        <span className={`gf-ch-key${ma50.available ? '' : ' off'}`}>
          <i className="ma50" /> MA50 {ma50.available ? '' : '(chưa đủ phiên)'}
        </span>
      </div>

      <div className="gf-ch-read gf-num">
        <span>{formatDateVN(hp.trade_date)}</span>
        <span className="strong">{toDong(Number(hp.close_price))}</span>
        <span className="src">{hp.is_manual ? 'thủ công' : hp.source.replace(/^auto:/, '').toUpperCase()}</span>
      </div>
    </div>
  );
}
