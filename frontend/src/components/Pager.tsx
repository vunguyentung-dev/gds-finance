import { clampPage, pageItems, pageRange } from '../lib/pagerMath';

interface Props {
  page: number;
  perPage: number;
  /** Tổng số dòng của TOÀN BỘ dữ liệu, không phải số dòng đang bày. */
  total: number;
  /** Đơn vị để đọc cho xuôi: "dòng", "lệnh"… */
  unit?: string;
  onGoTo: (page: number) => void;
}

/**
 * Thanh phân trang cho bảng.
 *
 * Khác thanh ở màn Nhật ký: bảng nằm trong khung có viền nên thanh gọn hơn, không
 * có ô "tới trang" (bảng giao dịch hiếm khi vượt vài chục trang), và đơn vị đếm
 * đổi được.
 */
export function Pager({ page, perPage, total, unit = 'dòng', onGoTo }: Props) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / perPage);
  if (totalPages <= 1) return null;

  const items = pageItems(page, totalPages);
  const { from, to } = pageRange(page, perPage, total);
  const go = (p: number) => onGoTo(clampPage(p, totalPages));

  return (
    <div className="gf-pager">
      <div className="gf-pager-count gf-num">
        {from}–{to} / {total} {unit}
      </div>

      <div className="gf-pager-bar">
        <button
          type="button"
          className="gf-pager-btn step"
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          title="Trang trước"
        >
          ‹
        </button>

        {items.map((it, i) =>
          it === 'gap' ? (
            <span key={`gap-${i}`} className="gf-pager-gap">
              …
            </span>
          ) : (
            <button
              key={it}
              type="button"
              className={`gf-pager-btn${it === page ? ' on' : ''}`}
              onClick={() => go(it)}
              disabled={it === page}
              aria-current={it === page ? 'page' : undefined}
            >
              {it}
            </button>
          ),
        )}

        <button
          type="button"
          className="gf-pager-btn step"
          onClick={() => go(page + 1)}
          disabled={page >= totalPages}
          title="Trang sau"
        >
          ›
        </button>
      </div>
    </div>
  );
}
