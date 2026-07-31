import type { FinEntry } from '../../api/finance';
import { formatDateVN, formatSignedTrieu } from '../../lib/format';
import { categoryColor } from './constants';

interface LedgerTableProps {
  entries: FinEntry[];
  onDelete: (id: number) => void;
}

export function LedgerTable({ entries, onDelete }: LedgerTableProps) {
  return (
    <div className="gf-fin-table-wrap">
      <div className="gf-fin-table-title">Sổ thu chi</div>
      {entries.length === 0 ? (
        <div className="gf-fin-empty-note" style={{ padding: '16px 18px' }}>
          Chưa có khoản thu/chi nào.
        </div>
      ) : (
        <table className="gf-fin-table gf-num">
          <thead>
            <tr>
              <th style={{ width: 110 }}>Ngày</th>
              <th>Ghi chú</th>
              <th style={{ width: 170 }}>Loại</th>
              <th style={{ width: 130, textAlign: 'right' }}>Số tiền</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="gf-fin-td-date">{formatDateVN(entry.entry_date)}</td>
                <td style={{ fontFamily: 'Manrope', fontWeight: 600 }}>{entry.note || '—'}</td>
                <td>
                  <span className="gf-fin-badge" style={{ background: categoryColor(entry.cat) }}>
                    {entry.cat}
                  </span>
                </td>
                <td
                  className="gf-fin-td-amount"
                  style={{ color: entry.entry_type === 'in' ? 'var(--up)' : 'var(--down)' }}
                >
                  {formatSignedTrieu(Number(entry.amount), entry.entry_type, 2)}
                </td>
                <td className="gf-fin-td-delete" onClick={() => onDelete(entry.id)}>
                  ✕
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
