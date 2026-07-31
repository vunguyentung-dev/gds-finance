import type { FinSummary } from '../../api/finance';
import { formatNetTrieu, toTrieu } from '../../lib/format';

interface StatCardsProps {
  summary: FinSummary;
  curYear: number;
  curMonth: number;
}

export function StatCards({ summary, curYear, curMonth }: StatCardsProps) {
  const monthTotal = summary.monthly[curMonth - 1] ?? { in: 0, out: 0 };

  return (
    <div className="gf-fin-stats">
      <div className="gf-fin-stat-card">
        <div className="gf-fin-stat-label">
          Thu · Tháng {curMonth}/{curYear}
        </div>
        <div className="gf-fin-stat-value gf-num" style={{ color: 'var(--up)' }}>
          {toTrieu(monthTotal.in)}
        </div>
      </div>
      <div className="gf-fin-stat-card">
        <div className="gf-fin-stat-label">
          Chi · Tháng {curMonth}/{curYear}
        </div>
        <div className="gf-fin-stat-value gf-num" style={{ color: 'var(--down)' }}>
          {toTrieu(monthTotal.out)}
        </div>
      </div>
      <div className="gf-fin-stat-card">
        <div className="gf-fin-stat-label">Thu · Năm {curYear}</div>
        <div className="gf-fin-stat-value gf-num" style={{ color: 'var(--up)' }}>
          {toTrieu(summary.inYear)}
        </div>
      </div>
      <div className="gf-fin-stat-card">
        <div className="gf-fin-stat-label">Chi · Năm {curYear}</div>
        <div className="gf-fin-stat-value gf-num" style={{ color: 'var(--down)' }}>
          {toTrieu(summary.outYear)}
        </div>
      </div>
      <div className="gf-fin-stat-card gf-fin-stat-hero">
        <div className="gf-fin-stat-label">Dòng tiền ròng năm</div>
        <div className="gf-fin-stat-value gf-num" style={{ color: summary.net >= 0 ? 'var(--up)' : 'var(--down)' }}>
          {formatNetTrieu(summary.net)}
        </div>
      </div>
    </div>
  );
}
