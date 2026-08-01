import type { Holding } from '../../api/overview';
import { formatDateVN, formatVN, signedDong, toDong, toQty } from '../../lib/format';

interface Props {
  rows: Holding[];
}

/** Sparkline từ các close THỰC CÓ — không nội suy phiên trống (mục 8.11). */
function Spark({ values }: { values: string[] }) {
  if (values.length < 2) return <span className="gf-ov-nodata">—</span>;
  const nums = values.map(Number);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const pts = nums
    .map((v, i) => {
      const x = (i / (nums.length - 1)) * 78 + 1;
      const y = 22 - ((v - min) / span) * 20;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const up = nums[nums.length - 1] >= nums[0];
  return (
    <svg width="80" height="24" viewBox="0 0 80 24" style={{ display: 'block', marginLeft: 'auto' }}>
      <polyline points={pts} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth="2" />
    </svg>
  );
}

export function HoldingsTable({ rows }: Props) {
  return (
    <div className="gf-ov-table-wrap">
      <div className="gf-ov-table-title">Danh mục nắm giữ</div>
      {rows.length === 0 ? (
        <div className="gf-ov-empty">Chưa nắm giữ mã nào. Nhập lệnh ở màn Giao dịch.</div>
      ) : (
        <table className="gf-ov-table gf-num">
          <thead>
            <tr>
              <th>Mã</th>
              <th>KL</th>
              <th>Giá vốn TB</th>
              <th>Giá TT</th>
              <th>Giá trị</th>
              <th>Lãi/lỗ tạm tính</th>
              <th>%</th>
              <th>Diễn biến</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              const upl = h.unrealized_pl === null ? null : Number(h.unrealized_pl);
              const color = upl === null ? undefined : upl >= 0 ? 'var(--up)' : 'var(--down)';
              return (
                <tr key={h.sym}>
                  <td>
                    <b>{h.sym}</b>
                    {h.price_source === 'manual' && <span className="gf-ov-src">nhập tay</span>}
                    {h.name && <div className="gf-ov-symname">{h.name}</div>}
                  </td>
                  <td>{toQty(Number(h.qty))}</td>
                  <td className="muted">{h.avg_cost === null ? '—' : toDong(Number(h.avg_cost))}</td>
                  <td>
                    {h.last === null ? (
                      <span className="gf-ov-nodata" title="Chưa có giá đóng cửa">
                        —
                      </span>
                    ) : (
                      <>
                        {toDong(Number(h.last))}
                        {h.trade_date && <div className="gf-ov-symname">{formatDateVN(h.trade_date)}</div>}
                      </>
                    )}
                  </td>
                  <td className="strong">
                    {h.market_value === null ? (
                      <span className="gf-ov-nodata">—</span>
                    ) : (
                      toDong(Number(h.market_value))
                    )}
                  </td>
                  <td className="bold" style={{ color }}>
                    {upl === null ? <span className="gf-ov-nodata">—</span> : signedDong(upl)}
                  </td>
                  <td className="strong" style={{ color }}>
                    {h.unrealized_pct === null ? (
                      <span className="gf-ov-nodata">—</span>
                    ) : (
                      `${Number(h.unrealized_pct) >= 0 ? '+' : ''}${formatVN(Number(h.unrealized_pct), 2)}%`
                    )}
                  </td>
                  <td>
                    <Spark values={h.spark} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
