import type { LotDetail as LotDetailData } from '../../api/stock';
import { formatDateVN, signedDong, toDong, toQty } from '../../lib/format';
import { formatSourceOnly, isDimmed, stalePrefix, staleTooltip } from '../../lib/price';

interface Props {
  detail: LotDetailData | null;
  loading: boolean;
  error: string;
  /** Lãi/lỗ CÙNG lệnh bán này theo engine B (FIFO), lấy từ flow. Để đối chiếu. */
  engineBPl: string | null;
  onClose: () => void;
  onRetry: () => void;
}

function plColor(v: number): string {
  return v >= 0 ? 'var(--up)' : 'var(--down)';
}

/**
 * Chi tiết khớp lô của MỘT lệnh bán — engine C (mục 7.5).
 *
 * Hai ràng buộc của mục 7.11 được cài ở đây, không phải tuỳ chọn:
 *  1. KHÔNG hiện matched_pl mà thiếu remaining. Khớp lô rẻ trước luôn làm sổ đã chốt
 *     đẹp lên và đẩy lô giá cao ở lại danh mục; hiện một nửa là báo lãi cao hơn thực
 *     chất. Hai khối nằm cạnh nhau trong cùng một panel, không tách tab.
 *  2. Mỗi số có NHÃN ENGINE. Ba engine ra ba số khác nhau trên cùng một lệnh bán —
 *     số không nhãn là số không đọc được.
 */
export function LotDetail({ detail, loading, error, engineBPl, onClose, onRetry }: Props) {
  // Lệnh do user ghim tay thì thứ tự KHÔNG phải "rẻ nhất trước" — nói vậy là ghi
  // nhãn sai. Nhãn phải nói đúng cách phân bổ đã dùng cho chính lệnh này.
  const pinned = detail !== null && detail.matches.some((m) => m.is_manual);

  return (
    <div className="gf-trade-table-wrap gf-lot">
      <div className="gf-trade-table-head gf-lot-head">
        <div>
          <div className="gf-trade-panel-title">
            Chi tiết khớp lô <span className="gf-lot-engine">engine C</span>
            {pinned && <span className="gf-lot-engine pin">ghim tay</span>}
          </div>
          <div className="gf-trade-table-sub">
            {pinned ? (
              <>
                Lô của lệnh này do <b>bạn tự chọn</b>, không theo thứ tự tự động. Các lần khớp lại về sau sẽ không ghi
                đè lựa chọn này.
              </>
            ) : (
              <>
                Khớp lô có <b>giá vốn thấp nhất trước</b> — tức lãi cao nhất trước.
              </>
            )}{' '}
            Cách này khác cả engine A (bình quân gia quyền) và engine B (FIFO), nên ba số lãi/lỗ khác nhau trên cùng
            một lệnh bán là đúng thiết kế.
          </div>
        </div>
        <button type="button" className="gf-lot-close" onClick={onClose} title="Đóng">
          ✕
        </button>
      </div>

      {loading && <div className="gf-trade-empty">Đang tải chi tiết lô…</div>}

      {!loading && error !== '' && (
        <div className="gf-lot-err">
          <div>{error}</div>
          <button type="button" onClick={onRetry}>
            Thử lại
          </button>
        </div>
      )}

      {!loading && error === '' && detail && <Body detail={detail} engineBPl={engineBPl} pinned={pinned} />}
    </div>
  );
}

function Body({
  detail,
  engineBPl,
  pinned,
}: {
  detail: LotDetailData;
  engineBPl: string | null;
  pinned: boolean;
}) {
  const matchedPl = Number(detail.matched_pl);
  const unmatched = Number(detail.unmatched_qty);
  const remaining = detail.remaining;
  const remainQty = Number(remaining.qty);
  const unreal = remaining.unrealized_pl === null ? null : Number(remaining.unrealized_pl);
  const bPl = engineBPl === null ? null : Number(engineBPl);
  const diff = bPl === null ? null : matchedPl - bPl;

  return (
    <>
      <div className="gf-lot-meta gf-num">
        <span>
          <b>{detail.sym}</b> · BÁN {toQty(Number(detail.qty))} cp @ {toDong(Number(detail.price))} ·{' '}
          {formatDateVN(detail.txn_date)}
        </span>
        <span className="gf-lot-meta-sub">
          Đơn giá bán ròng (đã trừ phí bán + thuế): {toDong(Number(detail.net_unit_price))}
        </span>
      </div>

      {unmatched > 0 && (
        <div className="gf-lot-warn">
          <span>⚠</span>
          <div>
            Lệnh bán <b>{toQty(Number(detail.qty))} cp</b> nhưng chỉ khớp được{' '}
            <b>{toQty(Number(detail.matched_qty))} cp</b> — thiếu <b>{toQty(unmatched)} cp</b> không có lô mua nào để
            khớp. Phần thiếu <b>không</b> được tạo dòng khớp, nên lãi/lỗ dưới đây chỉ tính trên phần khớp được.
          </div>
        </div>
      )}

      <div className="gf-lot-cols">
        {/* ---------- Đã chốt ---------- */}
        <div className="gf-lot-col">
          <div className="gf-lot-col-title">Đã chốt — các lô bị bán</div>

          {detail.matches.length === 0 ? (
            <div className="gf-trade-empty">Không có lô nào được khớp.</div>
          ) : (
            <table className="gf-trade-table gf-num gf-lot-table">
              <thead>
                <tr>
                  <th className="l">Lô mua</th>
                  <th>KL</th>
                  <th>Giá vốn/cp</th>
                  <th>Giá vốn khớp</th>
                  <th>Lãi/lỗ</th>
                </tr>
              </thead>
              <tbody>
                {detail.matches.map((m, i) => {
                  const pl = Number(m.pl);
                  return (
                    <tr key={m.buy_txn_id}>
                      <td className="l">
                        <div className="gf-lot-lotline">
                          <span className="gf-lot-order">{i + 1}</span>
                          <span className="date">{formatDateVN(m.buy_date)}</span>
                          {m.is_manual && (
                            <span className="gf-lot-tag manual" title="User tự ghim lô này, hệ thống không đổi">
                              ghim tay
                            </span>
                          )}
                          {!m.settled && (
                            <span className="gf-lot-tag unsettled" title={`Hàng về ${formatDateVN(m.settle_date)}`}>
                              lô chưa về
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="muted">{toQty(Number(m.qty))}</td>
                      <td className="muted">{toDong(Number(m.unit_cost))}</td>
                      <td>{toDong(Number(m.cost_matched))}</td>
                      <td className="strong" style={{ color: plColor(pl) }}>
                        {signedDong(pl)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="gf-lot-total">
            <div className="gf-lot-total-label">
              Lãi/lỗ đã chốt của lệnh này <span className="gf-lot-engine sm">engine C</span>
            </div>
            <div className="gf-lot-total-num gf-num" style={{ color: plColor(matchedPl) }}>
              {signedDong(matchedPl)}
            </div>
          </div>
        </div>

        {/* ---------- Còn nắm — BẮT BUỘC đi kèm, mục 7.6 ---------- */}
        <div className="gf-lot-col">
          <div className="gf-lot-col-title">Còn nắm — phần chênh lệch chuyển sang đây</div>

          {remainQty <= 0 ? (
            <div className="gf-trade-empty">
              Đã bán sạch {detail.sym}. Không còn lô nào, nên số đã chốt bên trái là số cuối cùng.
            </div>
          ) : (
            <table className="gf-trade-table gf-num gf-lot-table">
              <thead>
                <tr>
                  <th className="l">Lô mua</th>
                  <th>KL còn</th>
                  <th>Giá vốn/cp</th>
                  <th>Giá vốn còn</th>
                </tr>
              </thead>
              <tbody>
                {remaining.lots.map((l) => (
                  <tr key={l.buy_txn_id}>
                    <td className="l date">{formatDateVN(l.buy_date)}</td>
                    <td className="muted">{toQty(Number(l.qty))}</td>
                    <td className="muted">{toDong(Number(l.unit_cost))}</td>
                    <td>{toDong(Number(l.cost_basis))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {remainQty > 0 && (
            <div className="gf-lot-remain">
              <Line label={`Còn nắm (${toQty(remainQty)} cp) — giá vốn`} value={toDong(Number(remaining.cost_basis))} />

              {/* Mục 9.1: không được hiện giá mà giấu nguồn. */}
              <Line
                label="Giá thị trường"
                value={
                  remaining.price === null ? (
                    <span className="gf-lot-nodata">chưa có giá</span>
                  ) : (
                    <span title={staleTooltip(remaining.price)}>
                      {stalePrefix(remaining.price.staleness)}
                      {toDong(Number(remaining.price.close_price))}
                      <span className={`gf-lot-src${isDimmed(remaining.price.staleness) ? ' dim' : ''}`}>
                        {formatSourceOnly(remaining.price)}
                      </span>
                    </span>
                  )
                }
              />

              <Line
                label="Lãi/lỗ chưa thực hiện (đã trừ phí bán dự kiến)"
                value={
                  unreal === null ? (
                    <span className="gf-lot-nodata">— cần giá thị trường</span>
                  ) : (
                    <b style={{ color: plColor(unreal) }}>{signedDong(unreal)}</b>
                  )
                }
              />
            </div>
          )}
        </div>
      </div>

      {/* ---------- Đối chiếu engine, mục 7.1 ---------- */}
      {diff !== null && bPl !== null && (
        <div className={`gf-lot-cmp${diff === 0 ? ' same' : ''}`}>
          <div className="gf-lot-cmp-grid gf-num">
            <div>
              <div className="gf-lot-cmp-label">
                Engine B — FIFO <span className="gf-lot-cmp-hint">dùng cho cột Lũy kế ở bảng T+2</span>
              </div>
              <div className="gf-lot-cmp-num" style={{ color: plColor(bPl) }}>
                {signedDong(bPl)}
              </div>
            </div>
            <div>
              <div className="gf-lot-cmp-label">
                Engine C — {pinned ? 'lô ghim tay' : 'lô rẻ nhất trước'}{' '}
                <span className="gf-lot-cmp-hint">chỉ là thông tin của lệnh này</span>
              </div>
              <div className="gf-lot-cmp-num" style={{ color: plColor(matchedPl) }}>
                {signedDong(matchedPl)}
              </div>
            </div>
            <div>
              <div className="gf-lot-cmp-label">Chênh lệch</div>
              <div className="gf-lot-cmp-num">{diff === 0 ? '0' : signedDong(diff)}</div>
            </div>
          </div>

          <div className="gf-lot-cmp-note">
            {diff === 0 ? (
              <>
                Hai engine trùng nhau ở lệnh này vì nó ăn hết các lô có sẵn — khi bán hết thì thứ tự khớp không còn ảnh
                hưởng tới tổng. Chỉ khi bán <b>một phần</b> hai cách mới lệch nhau.
              </>
            ) : (
              <>
                Engine C <b>không tạo thêm đồng lãi nào</b>, nó chỉ dịch {toDong(Math.abs(diff))} giữa phần đã chốt và
                phần còn nắm: giá vốn phần còn nắm ở trên lệch khỏi engine B đúng chừng đó, ngược dấu. Vì vậy cột
                “Lũy kế” và thẻ “Tổng lãi/lỗ đã thực hiện” <b>vẫn giữ số của engine A/B</b> — engine C là lớp thông
                tin, không thay số tổng.
                {diff < 0 && (
                  <>
                    {' '}
                    Ở lệnh này engine C cho lãi <b>thấp hơn</b> engine B, vì lô đã chọn đắt hơn lô mà FIFO lấy — phần
                    chênh nằm lại ở giá vốn phần còn nắm, thấp đi đúng {toDong(Math.abs(diff))}.
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="gf-lot-line">
      <span className="gf-lot-line-label">{label}</span>
      <span className="gf-lot-line-val gf-num">{value}</span>
    </div>
  );
}
