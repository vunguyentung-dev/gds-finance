import type { SeriesPoint } from '../../api/overview';
import { formatDateVN, toDong } from '../../lib/format';

interface Props {
  points: SeriesPoint[];
  coverage: { points: number; trading_days: number; from: string; to: string };
}

const W = 600;
const H = 220;
const PAD = 4;

/**
 * Biểu đồ area giá trị danh mục. Không nội suy phiên trống (mục 8.11) — chỉ nối
 * các điểm thực có, và ghi rõ đang dựa trên bao nhiêu phiên.
 */
export function PortfolioChart({ points, coverage }: Props) {
  if (points.length === 0) {
    return (
      <div className="gf-ov-panel">
        <div className="gf-ov-chart-head">
          <div className="gf-ov-panel-title">Giá trị danh mục</div>
        </div>
        <div className="gf-ov-chart-empty">
          <div>
            Chưa dựng được đường giá trị: cần giá đóng cửa của <b>mọi mã đang nắm</b> trong cùng một phiên. Nhập giá bù
            ở panel phía trên rồi quay lại.
          </div>
        </div>
      </div>
    );
  }

  const values = points.map((p) => Number(p.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const xy = points.map((p, i) => {
    const x = points.length === 1 ? W / 2 : (i / (points.length - 1)) * (W - PAD * 2) + PAD;
    const y = H - PAD - ((Number(p.value) - min) / span) * (H - PAD * 2);
    return [x, y] as const;
  });

  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${PAD},${H - PAD} ${line} ${(W - PAD).toFixed(1)},${H - PAD}`;
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div className="gf-ov-panel">
      <div className="gf-ov-chart-head">
        <div className="gf-ov-panel-title">Giá trị danh mục</div>
        <div className="gf-ov-chart-meta gf-num">
          {coverage.points}/{coverage.trading_days} phiên có đủ giá
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="gf-ov-grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#gf-ov-grad)" />
        <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2" />
        {xy.map(([x, y], i) => (
          <circle key={points[i].trade_date} cx={x} cy={y} r="2.5" fill="var(--accent)" />
        ))}
      </svg>

      <div className="gf-ov-axis gf-num">
        <span>
          {formatDateVN(first.trade_date)} · {toDong(Number(first.value))}
        </span>
        <span>
          {formatDateVN(last.trade_date)} · {toDong(Number(last.value))}
        </span>
      </div>
    </div>
  );
}
