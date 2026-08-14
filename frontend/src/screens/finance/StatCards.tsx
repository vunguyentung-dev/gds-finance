import type { FinSummary, Invested } from '../../api/finance';
import { signedDong, toDong } from '../../lib/format';

interface StatCardsProps {
  summary: FinSummary;
  curYear: number;
  curMonth: number;
  /** null = chưa đọc được fin/invested. Hiện — thay vì đoán là 0. */
  invested: Invested | null;
}

export function StatCards({ summary, curYear, curMonth, invested }: StatCardsProps) {
  const monthTotal = summary.monthly[curMonth - 1] ?? { in: 0, out: 0 };

  return (
    <div className="gf-fin-stats">
      <div className="gf-fin-stat-card">
        <div className="gf-fin-stat-label">
          Thu · Tháng {curMonth}/{curYear}
        </div>
        <div className="gf-fin-stat-value gf-num" style={{ color: 'var(--up)' }}>
          {toDong(monthTotal.in)}
        </div>
      </div>
      <div className="gf-fin-stat-card">
        <div className="gf-fin-stat-label">
          Chi · Tháng {curMonth}/{curYear}
        </div>
        <div className="gf-fin-stat-value gf-num" style={{ color: 'var(--down)' }}>
          {toDong(monthTotal.out)}
        </div>
      </div>
      <div className="gf-fin-stat-card">
        <div className="gf-fin-stat-label">Thu · Năm {curYear}</div>
        <div className="gf-fin-stat-value gf-num" style={{ color: 'var(--up)' }}>
          {toDong(summary.inYear)}
        </div>
      </div>
      <div className="gf-fin-stat-card">
        <div className="gf-fin-stat-label">Chi · Năm {curYear}</div>
        <div className="gf-fin-stat-value gf-num" style={{ color: 'var(--down)' }}>
          {toDong(summary.outYear)}
        </div>
      </div>
      <div className="gf-fin-stat-card gf-fin-stat-hero">
        <div className="gf-fin-stat-label">Dòng tiền ròng năm</div>
        <div className="gf-fin-stat-value gf-num" style={{ color: summary.net >= 0 ? 'var(--up)' : 'var(--down)' }}>
          {signedDong(summary.net)}
        </div>
      </div>

      {/*
        Thẻ này CỘNG DỒN TOÀN BỘ lịch sử, không theo năm đang chọn — nên nhãn không
        mang năm như bốn thẻ trên. Nó cũng không nằm trong Thu/Chi: đây là tiền đã
        chuyển sang túi chứng khoán, chưa tiêu đi đâu.
      */}
      <div className="gf-fin-stat-card gf-fin-stat-inv">
        <div className="gf-fin-stat-label">Vốn đã bỏ vào thị trường</div>
        <div className="gf-fin-stat-value gf-num" style={{ color: 'var(--accent)' }}>
          {invested === null ? '—' : toDong(Number(invested.net))}
        </div>
        <div className="gf-fin-stat-sub gf-num">
          {invested === null
            ? 'Chưa đọc được số vốn'
            : `Đã nộp ${toDong(Number(invested.in))} · đã rút ${toDong(Number(invested.out))}`}
        </div>
      </div>
    </div>
  );
}
