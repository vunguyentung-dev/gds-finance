import type { BySymRow } from '../../api/stock';
import { formatVN, signedTrieu, toNghin, toQty, toTrieu } from '../../lib/format';

interface Props {
  rows: BySymRow[];
}

/** Bảng "Tổng hợp theo mã" — số liệu từ engine bình quân gia quyền. */
export function BySymTable({ rows }: Props) {
  return (
    <div className="gf-trade-table-wrap">
      <div className="gf-trade-table-head">
        <div className="gf-trade-panel-title">Tổng hợp theo mã</div>
      </div>
      {rows.length === 0 ? (
        <div className="gf-trade-empty">Chưa có giao dịch nào.</div>
      ) : (
        <table className="gf-trade-table gf-num">
          <thead>
            <tr>
              <th className="l">Mã</th>
              <th>KL còn lại</th>
              <th>Giá vốn TB</th>
              <th>Giá trị ròng</th>
              <th>Đã bán</th>
              <th>Lãi/lỗ thực hiện</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const realized = Number(r.realized);
              const sold = Number(r.sold);
              const color = realized >= 0 ? 'var(--up)' : 'var(--down)';
              const pct = r.realized_pct === null ? null : Number(r.realized_pct);
              return (
                <tr key={r.sym}>
                  <td className="l">
                    <b>{r.sym}</b>
                  </td>
                  <td>{toQty(Number(r.shares))}</td>
                  <td className="muted">{r.avg_cost === null ? '—' : toNghin(Number(r.avg_cost), 2)}</td>
                  <td className="strong">
                    {Number(r.shares) > 0 ? toTrieu(Number(r.net_value), 2) : '—'}
                  </td>
                  <td className="muted">{sold > 0 ? toQty(sold) : '—'}</td>
                  <td className="bold" style={{ color: sold > 0 ? color : undefined }}>
                    {sold > 0 ? signedTrieu(realized, 2) : '—'}
                  </td>
                  <td className="strong" style={{ color: sold > 0 ? color : undefined }}>
                    {sold > 0 && pct !== null ? `${pct >= 0 ? '+' : ''}${formatVN(pct, 2)}%` : '—'}
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
