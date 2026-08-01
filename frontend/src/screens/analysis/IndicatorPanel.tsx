import type { HistoryResponse } from '../../api/market';
import { formatDateVN, toDong } from '../../lib/format';

interface Props {
  data: HistoryResponse;
}

/** Trạng thái máy móc của một chỉ báo: nghiêng tăng / nghiêng giảm / trung tính. */
type Lean = 'up' | 'down' | 'flat';

function leanLabel(l: Lean): string {
  return l === 'up' ? 'nghiêng tăng' : l === 'down' ? 'nghiêng giảm' : 'trung tính';
}

/**
 * Bảng chỉ báo — số do BACKEND tính từ chuỗi giá đóng cửa trong sổ.
 *
 * Mỗi chỉ báo chỉ hiện khi đủ phiên; thiếu thì hiện đúng câu "cần N phiên, đang có M"
 * chứ không hiện số tính từ dữ liệu thiếu.
 *
 * Khối "Tổng hợp" là phép ĐẾM máy móc, và luôn hiện rõ đếm được mấy trên mấy cùng
 * từng phiếu một. Thiết kế gốc ghi "MUA — Tích cực"; ở đây dùng chữ mô tả trạng thái
 * chỉ báo thay vì chữ ra lệnh, vì đây là tổng hợp cơ học từ ba chỉ báo trên giá đóng
 * cửa, không phải khuyến nghị đầu tư.
 */
export function IndicatorPanel({ data }: Props) {
  const ind = data.indicators;
  const cov = data.coverage;

  const rsi = ind.rsi14.latest === null ? null : Number(ind.rsi14.latest);
  const macd = ind.macd.line.latest === null ? null : Number(ind.macd.line.latest);
  const hist = ind.macd.hist.latest === null ? null : Number(ind.macd.hist.latest);
  const ma20 = ind.ma20.latest === null ? null : Number(ind.ma20.latest);
  const ma50 = ind.ma50.latest === null ? null : Number(ind.ma50.latest);

  const votes: { name: string; lean: Lean; why: string }[] = [];
  if (rsi !== null) {
    const lean: Lean = rsi >= 55 ? 'up' : rsi <= 45 ? 'down' : 'flat';
    votes.push({ name: 'RSI(14)', lean, why: `RSI ${ind.rsi14.latest} so với ngưỡng 45 / 55` });
  }
  if (hist !== null) {
    const lean: Lean = hist > 0 ? 'up' : hist < 0 ? 'down' : 'flat';
    votes.push({ name: 'MACD', lean, why: `histogram ${toDong(hist)} (MACD ${macd === null ? '—' : toDong(macd)})` });
  }
  if (ma20 !== null && ma50 !== null) {
    const lean: Lean = ma20 > ma50 ? 'up' : ma20 < ma50 ? 'down' : 'flat';
    votes.push({ name: 'MA20 / MA50', lean, why: `MA20 ${toDong(ma20)} so với MA50 ${toDong(ma50)}` });
  }

  const up = votes.filter((v) => v.lean === 'up').length;
  const down = votes.filter((v) => v.lean === 'down').length;
  const overall: Lean = votes.length === 0 ? 'flat' : up > down ? 'up' : down > up ? 'down' : 'flat';

  return (
    <div className="gf-ind">
      <div className="gf-ind-head">
        <div className="gf-ind-title">
          Chỉ báo <span className="gf-ind-badge">sổ của bạn</span>
        </div>
        <div className="gf-ind-cov">
          {cov.sessions} phiên
          {cov.from && cov.to && (
            <>
              {' '}
              · {formatDateVN(cov.from)} → {formatDateVN(cov.to)}
            </>
          )}
          <br />
          {cov.manual} nhập tay · {cov.auto} tự động
        </div>
      </div>

      {/* RSI: có thanh như thiết kế, nhưng chỉ khi tính được */}
      <div className="gf-ind-row">
        <div className="gf-ind-row-head">
          <span className="gf-ind-name">RSI (14)</span>
          <span className="gf-ind-val gf-num">{ind.rsi14.latest ?? '—'}</span>
        </div>
        {rsi === null ? (
          <div className="gf-ind-why na">{ind.rsi14.reason}</div>
        ) : (
          <>
            <div className="gf-ind-track">
              <div
                className={`gf-ind-fill ${rsi >= 70 ? 'hot' : rsi <= 30 ? 'cold' : 'mid'}`}
                style={{ width: `${Math.max(0, Math.min(100, rsi))}%` }}
              />
            </div>
            <div className="gf-ind-why">
              {rsi >= 70 ? 'Vùng quá mua' : rsi <= 30 ? 'Vùng quá bán' : 'Vùng giữa'} · {leanLabel(
                rsi >= 55 ? 'up' : rsi <= 45 ? 'down' : 'flat',
              )}
            </div>
          </>
        )}
      </div>

      <Line
        name="MACD"
        value={macd === null ? null : toDong(macd)}
        tone={macd === null ? 'na' : macd > 0 ? 'up' : macd < 0 ? 'down' : 'flat'}
        reason={ind.macd.line.reason}
      />
      <Line
        name="Histogram MACD"
        value={hist === null ? null : toDong(hist)}
        tone={hist === null ? 'na' : hist > 0 ? 'up' : hist < 0 ? 'down' : 'flat'}
        reason={ind.macd.hist.reason}
      />
      <Line
        name="MA20"
        value={ma20 === null ? null : toDong(ma20)}
        tone="flat"
        reason={ind.ma20.reason}
      />
      <Line
        name="MA50"
        value={ma50 === null ? null : toDong(ma50)}
        tone="flat"
        reason={ind.ma50.reason}
      />
      <Line
        name="MA20 so MA50"
        value={ma20 !== null && ma50 !== null ? (ma20 > ma50 ? 'MA20 trên' : ma20 < ma50 ? 'MA20 dưới' : 'trùng') : null}
        tone={ma20 !== null && ma50 !== null ? (ma20 > ma50 ? 'up' : ma20 < ma50 ? 'down' : 'flat') : 'na'}
        reason={ind.ma50.reason ?? ind.ma20.reason}
      />

      {/* Tổng hợp: luôn phơi cách đếm, không đưa ra con số không giải thích được */}
      <div className={`gf-ind-sum ${overall}`}>
        <div className="gf-ind-sum-label">Tổng hợp máy móc</div>
        {votes.length === 0 ? (
          <>
            <div className="gf-ind-sum-big">Chưa tính được</div>
            <div className="gf-ind-sum-note">
              Chưa có chỉ báo nào đủ phiên. Cần ít nhất <b>15 phiên</b> cho RSI, <b>20</b> cho MA20, <b>34</b> cho
              MACD. Đang có <b>{cov.sessions}</b>.
            </div>
          </>
        ) : (
          <>
            <div className="gf-ind-sum-big">
              {up}/{votes.length} {leanLabel(overall)}
            </div>
            <ul className="gf-ind-sum-list">
              {votes.map((v) => (
                <li key={v.name} className={v.lean}>
                  <b>{v.name}</b> {leanLabel(v.lean)} — {v.why}
                </li>
              ))}
            </ul>
            <div className="gf-ind-sum-note">
              Đây là phép <b>đếm</b> trên {votes.length} chỉ báo tính từ giá đóng cửa trong sổ, không phải khuyến nghị.
              Chỉ báo chưa đủ phiên không được tính vào.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Line({
  name,
  value,
  tone,
  reason,
}: {
  name: string;
  value: string | null;
  tone: 'up' | 'down' | 'flat' | 'na';
  reason: string | null;
}) {
  return (
    <div className="gf-ind-row">
      <div className="gf-ind-row-head">
        <span className="gf-ind-name">{name}</span>
        <span className={`gf-ind-val gf-num ${tone}`}>{value ?? '—'}</span>
      </div>
      {value === null && reason && <div className="gf-ind-why na">{reason}</div>}
    </div>
  );
}
