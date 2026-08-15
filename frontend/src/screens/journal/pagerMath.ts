/** Một ô trên thanh số trang: số trang, hoặc dấu ba chấm ngăn quãng bị lược. */
export type PageItem = number | 'gap';

/** Số trang luôn hiện quanh trang đang xem, mỗi bên. */
const AROUND = 1;

/**
 * Số ô tối đa thuật toán lược có thể sinh ra: 1 + gap + (cur-1, cur, cur+1) + gap + cuối.
 * Tổng số trang không quá ngưỡng này thì hiện HẾT — lược bớt chẳng tiết kiệm được ô
 * nào mà lại giấu mất chỗ bấm. Với 5 trang đứng ở trang 1, lược sẽ ra "1 2 … 5" và
 * trang 3, 4 không có cách nào bấm tới trong một nhịp.
 */
const MAX_ITEMS = 7;

/**
 * Dựng danh sách ô cho thanh số trang.
 *
 * Luôn giữ trang đầu, trang cuối và vùng quanh trang đang đứng; phần bị lược thay
 * bằng 'gap'. Nhờ vậy thanh có bề rộng gần như cố định dù 5 trang hay 500 trang —
 * hiện hết số trang thì 20 trang đã tràn hàng, mà tràn hàng thì thanh nhảy chỗ mỗi
 * lần đổi trang.
 *
 * Chỉ chèn 'gap' khi nó thay cho TỪ HAI trang trở lên. Thay đúng một trang bằng dấu
 * ba chấm thì vừa mất một chỗ bấm vừa chẳng tiết kiệm được gì, nên trường hợp đó in
 * thẳng số trang ra.
 */
export function pageItems(current: number, total: number): PageItem[] {
  if (total <= 1) return [];
  if (total <= MAX_ITEMS) return Array.from({ length: total }, (_, i) => i + 1);

  const keep = new Set<number>([1, total]);
  for (let p = current - AROUND; p <= current + AROUND; p++) {
    if (p >= 1 && p <= total) keep.add(p);
  }

  const sorted = [...keep].sort((a, b) => a - b);
  const out: PageItem[] = [];
  let prev = 0;

  for (const p of sorted) {
    const missing = p - prev - 1;
    if (missing === 1) out.push(prev + 1);
    else if (missing > 1) out.push('gap');
    out.push(p);
    prev = p;
  }
  return out;
}

/** Kẹp trang về khoảng hợp lệ. total = 0 (lọc không ra gì) thì vẫn là trang 1. */
export function clampPage(page: number, total: number): number {
  if (total < 1) return 1;
  if (page < 1) return 1;
  return Math.min(page, total);
}

/**
 * Khoảng thứ tự đang bày, để hiện "81–100 / 137".
 * Trang cuối thường lẻ nên `to` phải kẹp theo tổng, không phải page * perPage.
 */
export function pageRange(page: number, perPage: number, total: number): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 };
  const from = (page - 1) * perPage + 1;
  return { from, to: Math.min(page * perPage, total) };
}
