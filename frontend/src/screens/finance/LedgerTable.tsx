import type { FinEntry } from '../../api/finance';
import { formatDateVN, toDong } from '../../lib/format';
import { categoryColor } from './constants';
import { entryColor, entrySign, invLabel, isInvType } from './entryType';

interface LedgerTableProps {
  entries: FinEntry[];
  onDelete: (id: number) => void;
}

export function LedgerTable({ entries, onDelete }: LedgerTableProps) {
  return (
    <div className="gf-fin-table-wrap">
      <div className="gf-fin-table-title">Sổ giao dịch</div>
      {entries.length === 0 ? (
        <div className="gf-fin-empty-note" style={{ padding: '16px 18px' }}>
          Chưa có khoản thu, chi hay đầu tư nào.
        </div>
      ) : (
        <table className="gf-fin-table gf-num">
          <thead>
            <tr>
              <th style={{ width: 110 }}>Ngày</th>
              <th>Ghi chú</th>
              <th style={{ width: 170 }}>Loại</th>
              <th style={{ width: 160, textAlign: 'right' }}>Số tiền</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const inv = isInvType(entry.entry_type);
              // Khoản đầu tư lấy nhãn từ entry_type, không lấy từ cat: cat là chuỗi
              // backend đóng dấu, còn chiều tiền là thứ người đọc cần thấy.
              const label = isInvType(entry.entry_type) ? invLabel(entry.entry_type) : entry.cat;
              const color = entryColor(entry.entry_type);

              return (
                <tr key={entry.id} className={inv ? 'gf-fin-tr-inv' : undefined}>
                  <td className="gf-fin-td-date">{formatDateVN(entry.entry_date)}</td>
                  <td style={{ fontFamily: 'Manrope', fontWeight: 600 }}>{entry.note || '—'}</td>
                  <td>
                    <span
                      className="gf-fin-badge"
                      style={{ background: inv ? color : categoryColor(entry.cat) }}
                    >
                      {label}
                    </span>
                  </td>
                  <td className="gf-fin-td-amount" style={{ color }}>
                    {entrySign(entry.entry_type)}
                    {toDong(Math.abs(Number(entry.amount)))}
                  </td>
                  <td className="gf-fin-td-delete" onClick={() => onDelete(entry.id)}>
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
