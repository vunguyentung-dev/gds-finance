import type { Quote, Symbol } from '../../api/market';
import { toDong } from '../../lib/format';
import { formatSourceOnly, isDimmed, stalePrefix, staleTooltip } from '../../lib/price';

export interface BoardRow {
  info: Symbol;
  quote: Quote | null;
}

interface Props {
  rows: BoardRow[];
  /** Mã đang mở ô nhập giá tay, null = không mở. */
  editing: string | null;
  editValue: string;
  saving: boolean;
  onStartEdit: (sym: string) => void;
  onEditChange: (value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
}

/** Tăng / giảm / tham chiếu — bảng màu ở README phần 3. */
function moveClass(q: Quote | null): string {
  if (q === null || q.change === null) return 'ref';
  const n = Number(q.change);
  if (n > 0) return 'up';
  if (n < 0) return 'down';
  return 'ref';
}

function signed(v: string): string {
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${toDong(n)}`;
}

function signedPct(v: string): string {
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function BoardTable({
  rows,
  editing,
  editValue,
  saving,
  onStartEdit,
  onEditChange,
  onCancelEdit,
  onSaveEdit,
}: Props) {
  return (
    <div className="gf-board-table-wrap">
      <table className="gf-board-table gf-num">
        <thead>
          <tr>
            <th className="l">Mã</th>
            <th>Trần</th>
            <th>Sàn</th>
            <th>TC</th>
            <th>Khớp</th>
            <th>+/−</th>
            <th>%</th>
            <th>KL</th>
            <th className="l">Nguồn giá</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ info, quote }) => {
            const cls = moveClass(quote);
            const band = quote?.band ?? null;
            const isEditing = editing === info.sym;
            return (
              <tr key={info.sym}>
                <td className="l">
                  <div className="gf-board-sym">{info.sym}</div>
                  <div className="gf-board-name" title={info.sector || undefined}>
                    {info.name || info.exchange}
                  </div>
                </td>

                {/* Trần/Sàn suy từ TC theo biên độ sàn — null thì '—', không đoán */}
                <td className="ceil">{band ? toDong(Number(band.ceiling)) : <Dash />}</td>
                <td className="flr">{band ? toDong(Number(band.floor)) : <Dash />}</td>
                <td className="muted">{quote?.prev_close ? toDong(Number(quote.prev_close)) : <Dash />}</td>

                <td className={`strong ${cls}`} title={staleTooltip(quote)}>
                  {quote === null ? (
                    <Dash />
                  ) : (
                    <>
                      {stalePrefix(quote.staleness)}
                      {toDong(Number(quote.close_price))}
                    </>
                  )}
                </td>
                <td className={cls}>{quote?.change ? signed(quote.change) : <Dash />}</td>
                <td className={cls}>{quote?.change_pct ? signedPct(quote.change_pct) : <Dash />}</td>

                {/* Khối lượng: fin_quote_history KHÔNG có cột volume. Không có số thì
                    để trống, không lấy số nào khác thay. */}
                <td className="muted">
                  <span className="gf-board-nodata" title="Chưa có nguồn khối lượng — xem ghi chú dưới bảng">
                    —
                  </span>
                </td>

                {/* Mục 9.1: không được hiện giá mà giấu nguồn */}
                <td className={`l gf-board-src${quote && isDimmed(quote.staleness) ? ' dim' : ''}`}>
                  {quote === null ? <span className="gf-board-nodata">chưa có giá</span> : formatSourceOnly(quote)}
                </td>

                <td className="gf-board-act">
                  {isEditing ? (
                    <div className="gf-board-edit">
                      <input
                        type="text"
                        className="gf-board-input gf-num"
                        placeholder="đồng/cp"
                        value={editValue}
                        onChange={(e) => onEditChange(e.target.value)}
                        autoFocus
                      />
                      <button type="button" className="gf-board-save" onClick={onSaveEdit} disabled={saving}>
                        Lưu
                      </button>
                      <button type="button" className="gf-board-cancel" onClick={onCancelEdit}>
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="gf-board-editbtn"
                      onClick={() => onStartEdit(info.sym)}
                      title="Nhập giá đóng cửa bằng tay cho phiên gần nhất"
                    >
                      nhập giá
                    </button>
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

function Dash() {
  return <span className="gf-board-nodata">—</span>;
}
