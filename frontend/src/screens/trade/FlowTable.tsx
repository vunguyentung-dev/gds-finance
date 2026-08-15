import { useMemo, useState } from 'react';
import { Pager } from '../../components/Pager';
import { clampPage } from '../../lib/pagerMath';
import type { FlowRow, SummaryFooter } from '../../api/stock';
import { formatDateVN, signedDong, toDong, toQty } from '../../lib/format';
import { SortHeader } from './SortHeader';
import {
  FLOW_LABELS,
  FLOW_VALUE,
  keepsRunningOrder,
  nextSort,
  sortRows,
  type SortState,
} from './sortRows';

interface Props {
  rows: FlowRow[];
  footer: SummaryFooter;
  /** Lệnh bán đang mở panel chi tiết lô (engine C), null = chưa mở. */
  openLotsId: string | null;
  onToggleLots: (id: string) => void;
}

function t2Label(r: FlowRow): { text: string; color: string } {
  if (r.t2_state === 'settled_future') {
    return { text: `Hàng về ${r.settle_date ? formatDateVN(r.settle_date) : '—'}`, color: 'var(--muted)' };
  }
  if (r.t2_state === 'short') {
    return { text: `⚠ Chỉ ${toQty(Number(r.t2_avail ?? '0'))} cp đã về (T+2)`, color: 'var(--down)' };
  }
  return { text: '✓ Hàng đã về', color: 'var(--up)' };
}

const PER_PAGE = 20;

/** Bảng "Diễn tiến giao dịch theo T+2" — số liệu từ engine FIFO. */
export function FlowTable({ rows, footer, openLotsId, onToggleLots }: Props) {
  const remain = Number(footer.flow_remain);
  const cumPl = Number(footer.cum_pl);
  const diff = Number(footer.engines_diff);

  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);

  /*
   * BA BƯỚC, đúng thứ tự này:
   *   1. sắp xếp trên TOÀN BỘ dữ liệu
   *   2. kiểm thứ tự cộng dồn cũng trên TOÀN BỘ
   *   3. mới cắt lấy một trang
   *
   * Sắp trong phạm vi trang sẽ ra kết quả sai — "sắp theo Lãi/lỗ" chỉ sắp 20 dòng
   * đang xem. Và keepsRunningOrder() so độ dài trước tiên, nên đưa một lát cắt 20
   * dòng vào đó thì nó luôn trả false và hai cột Lũy kế/Còn nắm biến mất ở MỌI
   * trang — hỏng mà nhìn vẫn có vẻ bình thường.
   */
  const ordered = useMemo(() => {
    // Mặc định: mới nhất trên đầu. Backend trả theo trình tự thời gian tăng dần,
    // nên đảo lại. Đảo NGUYÊN vẹn chứ không sắp theo cột ngày: bản đảo hoàn hảo
    // vẫn giữ được hai cột cộng dồn (cột đơn điệu, chỉ đọc ngược lên).
    if (sort === null) return [...rows].reverse();
    return sortRows(rows, sort, FLOW_VALUE[sort.key]);
  }, [rows, sort]);

  const showRunning = useMemo(() => keepsRunningOrder(ordered, rows), [ordered, rows]);

  const totalPages = Math.max(1, Math.ceil(ordered.length / PER_PAGE));
  const safePage = clampPage(page, totalPages);
  const shown = ordered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  // Đổi cột sắp xếp thì về trang 1: giữ nguyên trang 5 sau khi đổi cột là bày ra
  // một lát cắt chẳng liên quan gì tới thứ người dùng vừa bấm.
  const handleSort = (key: string) => {
    setSort((cur) => nextSort(cur, key));
    setPage(1);
  };

  return (
    <div className="gf-trade-table-wrap">
      <div className="gf-trade-table-head">
        <div className="gf-trade-panel-title">Diễn tiến giao dịch theo T+2</div>
        <div className="gf-trade-table-sub">
          Cổ phiếu chỉ bán được sau khi hàng về (T+2). Lãi/lỗ khớp theo <b>FIFO</b> (engine B), lũy kế đến khi bán
          sạch. Bấm <b>lô</b> ở cuối một lệnh bán để xem cách khớp của <b>engine C</b> — số sẽ khác, đó là thiết kế.
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="gf-trade-empty">Chưa có giao dịch nào.</div>
      ) : (
        <>
          {!showRunning && (
            <div className="gf-trade-sortwarn">
              <span>⚠</span>
              <div>
                Đang sắp theo <b>{sort === null ? '' : FLOW_LABELS[sort.key]}</b>, nên hai cột{' '}
                <b>Lũy kế</b> và <b>Còn nắm</b> tạm ẩn. Chúng là số cộng dồn theo trình tự
                thời gian — bày ra ở thứ tự khác thì lũy kế của một hàng đã gộp cả những
                hàng đang nằm dưới nó, đọc thành số vô nghĩa. Bấm{' '}
                <b>{sort === null ? '' : FLOW_LABELS[sort.key]}</b> thêm một lần nữa để bỏ sắp
                xếp và lấy lại hai cột.
              </div>
            </div>
          )}

          <table className="gf-trade-table gf-num">
            <thead>
              <tr>
                <SortHeader label="Ngày" sortKey="date" sort={sort} onSort={handleSort} align="l" />
                <SortHeader label="Mã" sortKey="sym" sort={sort} onSort={handleSort} align="l" />
                <SortHeader label="Loại" sortKey="type" sort={sort} onSort={handleSort} align="l" />
                <SortHeader label="KL" sortKey="qty" sort={sort} onSort={handleSort} />
                <SortHeader label="Giá" sortKey="price" sort={sort} onSort={handleSort} />
                <th className="l">Trạng thái T+2</th>
                <th>Dòng tiền ròng</th>
                <SortHeader label="Lãi/lỗ dòng" sortKey="pl" sort={sort} onSort={handleSort} />
                {showRunning && <th>Lũy kế</th>}
                {showRunning && <th>Còn nắm</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const isBuy = r.txn_type === 'buy';
                const t2 = t2Label(r);
                const cash = Number(r.cash);
                const rowPl = r.row_pl === null ? null : Number(r.row_pl);
                const cum = Number(r.cum_pl);
                return (
                  <tr key={r.id}>
                    <td className="l date">{formatDateVN(r.txn_date)}</td>
                    <td className="l">
                      <b>{r.sym}</b>
                    </td>
                    <td className="l">
                      <span className={`gf-trade-badge ${isBuy ? 'buy' : 'sell'}`}>{isBuy ? 'MUA' : 'BÁN'}</span>
                    </td>
                    <td className="muted">{toQty(Number(r.qty))}</td>
                    <td>{toDong(Number(r.price))}</td>
                    <td className="l gf-trade-t2" style={{ color: t2.color, fontFamily: 'Manrope' }}>
                      {t2.text}
                    </td>
                    <td style={{ color: cash >= 0 ? 'var(--up)' : 'var(--fg)' }}>{signedDong(cash)}</td>
                    <td
                      className="strong"
                      style={{ color: rowPl === null ? 'var(--muted2)' : rowPl >= 0 ? 'var(--up)' : 'var(--down)' }}
                    >
                      {rowPl === null ? '—' : signedDong(rowPl)}
                    </td>
                    {showRunning && (
                      <td className="bold" style={{ color: cum >= 0 ? 'var(--up)' : 'var(--down)' }}>
                        {signedDong(cum)}
                      </td>
                    )}
                    {showRunning && <td className="muted">{toQty(Number(r.remain))} cp</td>}
                    <td className="gf-trade-lots-cell">
                      {isBuy ? null : (
                        <button
                          type="button"
                          className={`gf-trade-lots-btn${openLotsId === r.id ? ' on' : ''}`}
                          onClick={() => onToggleLots(r.id)}
                          title="Xem lệnh bán này ăn vào lô mua nào (engine C)"
                        >
                          lô{openLotsId === r.id ? ' ▾' : ' ▸'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <Pager
            page={safePage}
            perPage={PER_PAGE}
            total={ordered.length}
            unit="lệnh"
            onGoTo={setPage}
          />

          <div className="gf-trade-foot">
            <div className="gf-trade-foot-label">
              {remain <= 0
                ? 'Đã bán sạch — lãi/lỗ cuối cùng'
                : `Còn nắm ${toQty(remain)} cp — lãi/lỗ đã chốt`}
            </div>
            <div className="gf-trade-foot-num gf-num" style={{ color: cumPl >= 0 ? 'var(--up)' : 'var(--down)' }}>
              {signedDong(cumPl)}
            </div>
          </div>

          {footer.engines_diverge && (
            <div className="gf-trade-diverge">
              <span>⚠</span>
              <div>
                <b>Hai cách tính đang lệch nhau {toDong(Math.abs(diff))}.</b> Số ở chân bảng này (
                {signedDong(cumPl)}) khớp lô theo <b>FIFO</b>, còn thẻ “Tổng lãi/lỗ đã thực hiện” đầu màn (
                {signedDong(Number(footer.total_realized))}) dùng <b>giá vốn bình quân</b>. Chênh lệch phát sinh
                khi có nhiều lô mua khác giá hoặc lệnh bán vượt số hàng đã về.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
