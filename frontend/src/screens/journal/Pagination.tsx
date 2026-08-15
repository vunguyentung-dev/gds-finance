import { useState } from 'react';
import { JOURNAL_PER_PAGE } from '../../api/journal';
import { clampPage, pageItems, pageRange } from './pagerMath';

interface Props {
  page: number;
  totalPages: number;
  /** Tổng ghi chép SAU khi lọc. */
  total: number;
  /** false = backend chưa hỗ trợ phân trang, đã trả hết trong một lượt. */
  paged: boolean;
  loading: boolean;
  error: string;
  onGoTo: (page: number) => void;
}

/**
 * Thanh số trang: bấm thẳng vào trang muốn xem.
 *
 * Khối luôn chiếm chỗ cố định khi đang tải để danh sách phía trên không giật, và
 * số ô trên thanh gần như không đổi nhờ pageItems() lược bớt quãng giữa.
 */
export function Pagination({ page, totalPages, total, paged, loading, error, onGoTo }: Props) {
  // Hook phải đứng TRƯỚC mọi lệnh return sớm, nếu không thứ tự hook đổi giữa các
  // lần render và React vỡ.
  const [jump, setJump] = useState('');

  if (total === 0) return null;

  const items = pageItems(page, totalPages);
  const { from, to } = pageRange(page, JOURNAL_PER_PAGE, total);

  /**
   * Nhảy thẳng tới một trang bất kỳ.
   *
   * Thanh số chỉ chứa tối đa 7 ô, nên với 20 trang mà đang đứng ở trang 1 thì
   * KHÔNG có nút số 5 để bấm — phải bấm lần lượt 2, 3, 4, 5. Ô này lấp đúng chỗ đó,
   * và không phình ra theo số trang như việc in hết mọi số.
   */
  const doJump = () => {
    const n = Number(jump.trim());
    if (!Number.isFinite(n) || jump.trim() === '') return;
    setJump('');
    const target = clampPage(Math.trunc(n), totalPages);
    if (target !== page) onGoTo(target);
  };

  return (
    <div className="gf-jn-pager">
      <div className="gf-jn-pager-count gf-num">
        {paged && totalPages > 1 ? (
          <>
            Đang xem {from}–{to} / {total} ghi chép · trang <b>{page}</b> / {totalPages}
          </>
        ) : (
          <>{total} ghi chép</>
        )}
      </div>

      {items.length > 0 && (
        <div className="gf-jn-pager-bar">
          <button
            type="button"
            className="gf-jn-pg gf-jn-pg-step"
            onClick={() => onGoTo(page - 1)}
            disabled={page <= 1 || loading}
            title="Trang trước"
          >
            ‹
          </button>

          {items.map((it, i) =>
            it === 'gap' ? (
              // key theo vị trí: hai dấu ba chấm không phân biệt được bằng nội dung
              <span key={`gap-${i}`} className="gf-jn-pg-gap">
                …
              </span>
            ) : (
              <button
                key={it}
                type="button"
                className={`gf-jn-pg${it === page ? ' on' : ''}`}
                onClick={() => onGoTo(it)}
                disabled={loading || it === page}
                aria-current={it === page ? 'page' : undefined}
              >
                {it}
              </button>
            ),
          )}

          <button
            type="button"
            className="gf-jn-pg gf-jn-pg-step"
            onClick={() => onGoTo(page + 1)}
            disabled={page >= totalPages || loading}
            title="Trang sau"
          >
            ›
          </button>
        </div>
      )}

      {/* Chỉ cần khi thanh không chứa hết số trang; ít trang thì bấm thẳng là xong. */}
      {totalPages > 7 && (
        <div className="gf-jn-pager-jump">
          <label htmlFor="gf-jn-jump">Tới trang</label>
          <input
            id="gf-jn-jump"
            type="text"
            inputMode="numeric"
            className="gf-num"
            value={jump}
            placeholder={String(page)}
            onChange={(e) => setJump(e.target.value.replace(/[^\d]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doJump();
            }}
          />
          <span className="gf-jn-pager-jump-total gf-num">/ {totalPages}</span>
          <button type="button" onClick={doJump} disabled={loading || jump.trim() === ''}>
            Đi
          </button>
        </div>
      )}

      {loading && <div className="gf-jn-pager-loading">Đang tải…</div>}
      {error && <div className="gf-jn-pager-err">{error}</div>}
    </div>
  );
}
