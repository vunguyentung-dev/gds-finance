import { JOURNAL_PER_PAGE } from '../../api/journal';

interface Props {
  /** Số ghi chép đang bày ra. */
  shown: number;
  /** Tổng số SAU khi lọc, do backend đếm. */
  total: number;
  /** false = backend chưa hỗ trợ phân trang, đã trả hết trong một lượt. */
  paged: boolean;
  loading: boolean;
  error: string;
  onLoadMore: () => void;
}

/**
 * Chân danh sách: tiến độ + nút tải thêm.
 *
 * Luôn chiếm chỗ kể cả lúc đang tải, và nút giữ nguyên kích thước khi đổi chữ —
 * nếu để nó co lại hay biến mất thì phần danh sách phía trên bị giật lên đúng lúc
 * người dùng đang đọc.
 */
export function LoadMore({ shown, total, paged, loading, error, onLoadMore }: Props) {
  if (shown === 0) return null;

  const done = shown >= total;

  return (
    <div className="gf-jn-more">
      <div className="gf-jn-more-count gf-num">
        {paged ? (
          <>
            Đang xem {shown} / {total} ghi chép
          </>
        ) : (
          <>{total} ghi chép</>
        )}
      </div>

      {done ? (
        <div className="gf-jn-more-done">Đã hiển thị tất cả</div>
      ) : (
        <button type="button" className="gf-jn-more-btn" onClick={onLoadMore} disabled={loading}>
          {loading ? 'Đang tải…' : `Tải thêm ${Math.min(JOURNAL_PER_PAGE, total - shown)} ghi chép`}
        </button>
      )}

      {error && <div className="gf-jn-more-err">{error}</div>}
    </div>
  );
}
