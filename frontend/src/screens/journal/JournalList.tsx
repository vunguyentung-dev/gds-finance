import type { JournalEntry } from '../../api/journal';
import { formatDateTimeVN, formatVnIndex } from '../../lib/format';
import { flagOf, moodOf } from './constants';

interface Props {
  entries: JournalEntry[];
  onVoid: (id: string) => void;
}

export function JournalList({ entries, onVoid }: Props) {
  if (entries.length === 0) {
    return <div className="gf-jn-empty">Không có nhật ký nào khớp bộ lọc.</div>;
  }

  return (
    <div className="gf-jn-list">
      {entries.map((e) => {
        const mood = moodOf(e.mood);
        const flag = flagOf(e.flag);
        const hasFlag = e.flag !== 'none';
        return (
          <div key={e.id} className="gf-jn-card">
            <div className="gf-jn-card-head">
              <span className="gf-jn-card-icon">{mood.icon}</span>
              <span className="gf-jn-badge" style={{ background: mood.color }}>
                {mood.label}
              </span>
              {hasFlag && (
                <span className="gf-jn-badge" style={{ background: flag.color }}>
                  {flag.icon} {flag.label}
                </span>
              )}
              {e.vnindex !== null && (
                <span className="gf-jn-vnindex gf-num">VN-Index {formatVnIndex(Number(e.vnindex))}</span>
              )}
              <span className="gf-jn-at gf-num">{formatDateTimeVN(e.noted_at)}</span>
              <span className="gf-jn-del" title="Bỏ ghi (giữ vết kiểm toán)" onClick={() => onVoid(e.id)}>
                ✕
              </span>
            </div>
            <div className="gf-jn-body">{e.body}</div>
          </div>
        );
      })}
    </div>
  );
}
