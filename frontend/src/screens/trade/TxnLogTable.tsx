import { useMemo, useState } from 'react';
import type { StockTxn } from '../../api/stock';
import { formatDateVN, toDong, toQty } from '../../lib/format';
import { SortHeader } from './SortHeader';
import { TXN_VALUE, nextSort, sortRows, type SortState } from './sortRows';

interface Props {
  rows: StockTxn[];
  onVoid: (id: string) => void;
}

/**
 * Bảng "Lịch sử giao dịch" — net_price/net_value do backend tính sẵn.
 *
 * Bảng này sắp xếp thoải mái: mọi cột đều là thuộc tính RIÊNG của từng lệnh, không
 * có số cộng dồn nào. Khác hẳn bảng T+2, nơi Lũy kế và Còn nắm phụ thuộc thứ tự.
 */
export function TxnLogTable({ rows, onVoid }: Props) {
  const [sort, setSort] = useState<SortState | null>(null);

  const shown = useMemo(
    () => (sort === null ? rows : sortRows(rows, sort, TXN_VALUE[sort.key])),
    [rows, sort],
  );

  const handleSort = (key: string) => setSort((cur) => nextSort(cur, key));

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
              <SortHeader label="Ngày" sortKey="date" sort={sort} onSort={handleSort} align="l" />
              <SortHeader label="Mã" sortKey="sym" sort={sort} onSort={handleSort} align="l" />
              <SortHeader label="Loại" sortKey="type" sort={sort} onSort={handleSort} align="l" />
              <SortHeader label="KL" sortKey="qty" sort={sort} onSort={handleSort} />
              <SortHeader label="Giá" sortKey="price" sort={sort} onSort={handleSort} />
              <th>Giá sau phí/thuế</th>
              <th>Giá trị ròng</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => {
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
                  <td>{toDong(Number(t.price))}</td>
                  <td className="muted">{toDong(Number(t.net_price))}</td>
                  <td className="strong">{toDong(Number(t.net_value))}</td>
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
