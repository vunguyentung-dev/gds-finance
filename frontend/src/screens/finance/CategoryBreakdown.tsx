import { toTrieu } from '../../lib/format';

export interface CategoryItem {
  name: string;
  amount: number;
  pct: number;
  color: string;
}

interface CategoryBreakdownProps {
  items: CategoryItem[];
  yearLabel: string;
}

export function CategoryBreakdown({ items, yearLabel }: CategoryBreakdownProps) {
  return (
    <div className="gf-fin-panel">
      <div className="gf-fin-panel-title" style={{ marginBottom: 14 }}>
        Chi tiêu theo loại · {yearLabel}
      </div>
      {items.length === 0 ? (
        <div className="gf-fin-empty-note">Chưa có dữ liệu chi tiêu.</div>
      ) : (
        items.map((c) => (
          <div key={c.name} className="gf-fin-cat-row">
            <div className="gf-fin-cat-head">
              <span className="gf-fin-cat-name">{c.name}</span>
              <span className="gf-fin-cat-value gf-num">
                {toTrieu(c.amount, 1)} · {c.pct.toFixed(0)}%
              </span>
            </div>
            <div className="gf-fin-cat-track">
              <div className="gf-fin-cat-fill" style={{ width: `${c.pct}%`, background: c.color }} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}
