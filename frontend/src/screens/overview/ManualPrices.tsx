import type { Holding } from '../../api/overview';
import { describeDong, formatDateTimeVN, formatDateVN, parseVNNumber, toDong, toQty } from '../../lib/format';

export interface PriceDraftRow {
  sym: string;
  close: string;
}

interface Props {
  holdings: Holding[];
  /** Phiên sẽ được ghi giá. Upsert theo (sym, trade_date) nên nhập lại là GHI ĐÈ. */
  session: string;
  drafts: Record<string, string>;
  saving: boolean;
  error: string;
  okMessage: string;
  onChange: (sym: string, value: string) => void;
  onSubmit: (rows: PriceDraftRow[]) => void;
}

/** Giá đang lưu ĐÚNG cho phiên này, hay chỉ là giá của phiên cũ hơn. */
function storedForSession(h: Holding, session: string): string | null {
  if (h.price === null) return null;
  return h.price.trade_date === session ? h.price.close_price : null;
}

/**
 * Nhập / SỬA giá đóng cửa thủ công cho mọi mã đang nắm.
 *
 * Panel này thay cho PriceGaps cũ. PriceGaps chỉ liệt kê mã "còn thiếu" và cả khối bị
 * ẩn khi không còn mã nào thiếu, nên nhập sai một lần là không có đường sửa. Ở đây
 * luôn liệt kê ĐỦ mã đang nắm và ô nhập không bao giờ bị khoá.
 *
 * Ô nhập được điền sẵn giá đang lưu CHỈ KHI giá đó thuộc đúng phiên đang ghi. Nếu mã
 * chỉ có giá của phiên cũ hơn thì để trống và hiện giá cũ ở dòng chú thích — điền sẵn
 * giá cũ sẽ dễ khiến người dùng bấm Lưu và đóng dấu giá cũ thành giá của phiên mới.
 */
export function ManualPrices({
  holdings,
  session,
  drafts,
  saving,
  error,
  okMessage,
  onChange,
  onSubmit,
}: Props) {
  // Chỉ gửi dòng THỰC SỰ đổi: nhập lại đúng giá cũ thì không cần ghi, tránh dời
  // fetched_at mà chẳng sửa gì.
  const changed: PriceDraftRow[] = [];
  for (const h of holdings) {
    const raw = drafts[h.sym];
    if (raw === undefined) continue;
    const v = parseVNNumber(raw);
    if (v <= 0) continue;
    const stored = storedForSession(h, session);
    if (stored !== null && Number(stored) === v) continue;
    changed.push({ sym: h.sym, close: String(v) });
  }

  const missingThisSession = holdings.filter((h) => storedForSession(h, session) === null);

  return (
    <div className="gf-ov-panel">
      <div className="gf-ov-panel-title">Giá đóng cửa thủ công</div>
      <div className="gf-ov-panel-sub">
        Ghi cho phiên <b>{formatDateVN(session)}</b>, giá tính bằng đồng/cổ phiếu. Nhập lại cùng mã cùng phiên là{' '}
        <b>ghi đè</b> giá cũ — sửa được bất cứ lúc nào. Giá tự động sẽ không ghi đè giá bạn nhập tay.
        {missingThisSession.length > 0 && (
          <>
            {' '}
            Còn <b>{missingThisSession.length}</b> mã chưa có giá cho phiên này:{' '}
            <b>{missingThisSession.map((h) => h.sym).join(', ')}</b>.
          </>
        )}
      </div>

      {holdings.length === 0 && (
        <div className="gf-ov-empty">Chưa nắm mã nào, nên không có giá gì để nhập.</div>
      )}

      {holdings.map((h) => {
        const stored = storedForSession(h, session);
        const raw = drafts[h.sym] ?? (stored !== null ? toDong(Number(stored)) : '');
        const typed = parseVNNumber(raw);
        const hint = describeDong(typed);
        const isChanged = changed.some((c) => c.sym === h.sym);

        return (
          <div key={h.sym} className="gf-ov-gaprow">
            <div className="gf-ov-sym">
              {h.sym}
              {stored === null ? (
                <span className="gf-mp-tag miss">chưa có</span>
              ) : (
                <span className="gf-mp-tag have">phiên này</span>
              )}
            </div>

            <div>
              <label className="gf-ov-label">
                Giá đóng cửa (₫/cp) · KL {toQty(Number(h.qty))}
              </label>
              <input
                type="text"
                className={`gf-ov-input gf-num${isChanged ? ' gf-mp-dirty' : ''}`}
                placeholder="19.100"
                value={raw}
                onChange={(e) => onChange(h.sym, e.target.value)}
              />
            </div>

            <div className="gf-ov-hint">
              {isChanged && stored !== null ? (
                <>
                  Sẽ ghi đè {toDong(Number(stored))} → <b>{toDong(typed)}</b>
                </>
              ) : hint && stored === null ? (
                hint
              ) : stored !== null ? (
                <>
                  Đang lưu {toDong(Number(stored))}
                  {h.price && (
                    <>
                      {' '}
                      · {h.price.is_manual ? 'thủ công' : h.price.source.replace(/^auto:/, '').toUpperCase()}
                      {h.price.fetched_at && <> · ghi lúc {formatDateTimeVN(h.price.fetched_at)}</>}
                    </>
                  )}
                </>
              ) : h.price ? (
                <>
                  Chưa có giá cho phiên này. Giá gần nhất: {toDong(Number(h.price.close_price))} (
                  {formatDateVN(h.price.trade_date)})
                </>
              ) : (
                'Chưa có giá nào cho mã này'
              )}
            </div>
          </div>
        );
      })}

      {holdings.length > 0 && (
        <button
          type="button"
          className="gf-ov-btn"
          onClick={() => onSubmit(changed)}
          disabled={saving || changed.length === 0}
        >
          {saving ? 'Đang lưu…' : changed.length > 0 ? `Lưu ${changed.length} mã` : 'Chưa có gì để lưu'}
        </button>
      )}

      {error && <div className="gf-ov-error">{error}</div>}
      {okMessage && <div className="gf-ov-ok">{okMessage}</div>}
    </div>
  );
}
