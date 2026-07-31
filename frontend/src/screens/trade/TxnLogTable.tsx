import type { StockTxn } from '../../api/stock';
import { formatDateVN, toNghin, toQty, toTrieu } from '../../lib/format';

interface Props {
  rows: StockTxn[];
  onVoid: (id: string) => void;
}

/** Bảng "Lịch sử giao dịch" — net_price/net_value do backend tính sẵn. */
export function TxnLogTable({ rows, onVoid }: Props) {
  return (
    <div className="gf-trade-table-wrap">
      <div className="gf-trade-table-head">
        <div className="gf-trade-panel-title">Lịch sử giao dịch</div>
      </div>
      {rows.length === 0 ? (
        <div className="gf-trade-empty">Chưa có giao dịch nào.</div>
      ) : (
        <table className="gf-trade-table gf-num">
          <thead>
            <tr>
              <th className="l">Ngày</th>
              <th className="l">Mã</th>
              <th className="l">Loại</th>
              <th>KL</th>
              <th>Giá</th>
              <th>Giá sau phí/thuế</th>
              <th>Giá trị ròng</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const isBuy = t.txn_type === 'buy';
              return (
                <tr key={t.id}>
                  <td className="l date">{formatDateVN(t.txn_date)}</td>
                  <td className="l">
                    <b>{t.sym}</b>
                  </td>
                  <td className="l">
                    <span className={`gf-trade-badge ${isBuy ? 'buy' : 'sell'}`}>{isBuy ? 'MUA' : 'BÁN'}</span>
                  </td>
                  <td className="muted">{toQty(Number(t.qty))}</td>
                  <td>{toNghin(Number(t.price), 1)}</td>
                  <td className="muted">{toNghin(Number(t.net_price), 2)}</td>
                  <td className="strong">{toTrieu(Number(t.net_value), 2)}</td>
                  <td
                    className="gf-trade-del"
                    title="Bỏ ghi giao dịch (giữ vết kiểm toán)"
                    onClick={() => onVoid(t.id)}
                  >
                    ✕
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
