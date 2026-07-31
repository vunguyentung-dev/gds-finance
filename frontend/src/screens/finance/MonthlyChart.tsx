export interface ChartBar {
  label: string;
  inPct: number;
  outPct: number;
}

interface MonthlyChartProps {
  bars: ChartBar[];
  yearLabel: string;
}

export function MonthlyChart({ bars, yearLabel }: MonthlyChartProps) {
  return (
    <div className="gf-fin-panel">
      <div className="gf-fin-chart-head">
        <div className="gf-fin-panel-title">Thu / chi 12 tháng · {yearLabel}</div>
        <div className="gf-fin-chart-legend">
          <span className="gf-fin-chart-legend-item">
            <span className="gf-fin-legend-dot" style={{ background: 'var(--up)' }} />
            Thu
          </span>
          <span className="gf-fin-chart-legend-item">
            <span className="gf-fin-legend-dot" style={{ background: 'var(--down)' }} />
            Chi
          </span>
        </div>
      </div>
      <div className="gf-fin-chart-bars">
        {bars.map((b) => (
          <div key={b.label} className="gf-fin-chart-col">
            <div className="gf-fin-chart-bars-inner">
              <div className="gf-fin-bar in" style={{ height: `${b.inPct}%` }} />
              <div className="gf-fin-bar out" style={{ height: `${b.outPct}%` }} />
            </div>
            <div className="gf-fin-chart-label">{b.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
