import type { RowStatus } from '../../api/checklist';
import { checklistEntries } from './defs';

export type RowState = Record<string, { row_status: RowStatus; val: string }>;

interface Props {
  rows: RowState;
  onStatus: (rowKey: string, status: Exclude<RowStatus, ''>) => void;
  onVal: (rowKey: string, val: string) => void;
}

const STATUS_LABELS: { id: Exclude<RowStatus, ''>; label: string }[] = [
  { id: 'ok', label: 'Đạt' },
  { id: 'no', label: 'Chưa' },
  { id: 'na', label: 'N/A' },
];

export function CriteriaTable({ rows, onStatus, onVal }: Props) {
  return (
    <div className="gf-cl-table-wrap">
      <table className="gf-cl-table">
        <thead>
          <tr>
            <th style={{ width: 44 }}>STT</th>
            <th style={{ width: '22%' }}>Tiêu chí</th>
            <th style={{ width: 180 }}>Đánh giá của bạn</th>
            <th style={{ width: 150 }}>Trạng thái</th>
            <th>Giải thích &amp; ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {checklistEntries.map((e, i) => {
            if (e.kind === 'banner') {
              return (
                <tr key={`b${i}`} className={`gf-cl-banner ${e.tone}`}>
                  <td colSpan={5}>{e.label}</td>
                </tr>
              );
            }
            const st = rows[e.rowKey] ?? { row_status: '' as RowStatus, val: '' };
            return (
              <tr key={e.rowKey} className="crit">
                <td className="gf-cl-stt gf-num">{e.stt}</td>
                <td className="gf-cl-critname">{e.label}</td>
                <td>
                  <input
                    type="text"
                    className="gf-cl-valinput"
                    placeholder="Ghi nhận…"
                    value={st.val}
                    onChange={(ev) => onVal(e.rowKey, ev.target.value)}
                  />
                </td>
                <td>
                  <div className="gf-cl-status">
                    {STATUS_LABELS.map((s) => {
                      const on = st.row_status === s.id;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          className={`gf-cl-st${on ? ` on on-${s.id}` : ''}`}
                          onClick={() => onStatus(e.rowKey, s.id)}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </td>
                <td className="gf-cl-explain">
                  {e.explain}
                  {e.note && (
                    <div className="gf-cl-note">
                      <b>Ghi chú:</b> {e.note}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
