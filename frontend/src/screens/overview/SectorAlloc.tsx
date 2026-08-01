import type { SectorSlice } from '../../api/overview';
import { formatVN, toDong } from '../../lib/format';

interface Props {
  slices: SectorSlice[];
  pricedCount: number;
}

export function SectorAlloc({ slices, pricedCount }: Props) {
  return (
    <div className="gf-ov-panel">
      <div className="gf-ov-panel-title">Phân bổ theo ngành</div>
      <div className="gf-ov-panel-sub">
        {pricedCount > 0
          ? `Tính theo giá thị trường của ${pricedCount} mã có giá.`
          : 'Cần giá thị trường để tính tỉ trọng.'}
      </div>
      {slices.length === 0 ? (
        <div className="gf-ov-note">Chưa có dữ liệu.</div>
      ) : (
        slices.map((s) => (
          <div key={s.sector} className="gf-ov-sector">
            <div className="gf-ov-sector-head">
              <span className="gf-ov-sector-name">{s.sector}</span>
              <span className="gf-ov-sector-val gf-num">
                {toDong(Number(s.value))}
                {s.pct !== null && ` · ${formatVN(Number(s.pct), 0)}%`}
              </span>
            </div>
            <div className="gf-ov-sector-track">
              <div className="gf-ov-sector-fill" style={{ width: `${s.pct === null ? 0 : Number(s.pct)}%` }} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}
