import type { FlowRow, StockTxn } from '../../api/stock';

export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: string;
  dir: SortDir;
}

/** Giá trị đem so sánh. null = ô không có số (vd lãi/lỗ của một lệnh MUA). */
export type SortValue = number | string | null;

/**
 * Ba trạng thái, không phải hai: chưa sắp → tăng → giảm → **về mặc định**.
 *
 * Cần nhịp thứ ba vì cột "Lũy kế" và "Còn nắm" chỉ hiện ở thứ tự gốc. Nếu chỉ có
 * tăng/giảm thì người dùng lỡ sắp theo Mã sẽ không có đường quay lại xem hai cột đó
 * ngoài việc tải lại trang.
 */
export function nextSort(cur: SortState | null, key: string): SortState | null {
  if (cur === null || cur.key !== key) return { key, dir: 'asc' };
  if (cur.dir === 'asc') return { key, dir: 'desc' };
  return null;
}

function compare(a: Exclude<SortValue, null>, b: Exclude<SortValue, null>): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'vi');
}

export function sortRows<T>(
  rows: T[],
  sort: SortState | null,
  value: (row: T) => SortValue,
): T[] {
  if (sort === null) return rows;
  const dir = sort.dir === 'asc' ? 1 : -1;

  // Array.prototype.sort ổn định từ ES2019: hai hàng bằng nhau giữ nguyên thứ tự
  // gốc. Nhờ đó kết quả không phụ thuộc thuật toán sắp xếp của engine, và sắp theo
  // Mã vẫn giữ đúng trình tự thời gian bên trong từng mã.
  return [...rows].sort((x, y) => {
    const a = value(x);
    const b = value(y);

    // Ô trống LUÔN nằm cuối, cả khi tăng lẫn khi giảm — nên KHÔNG nhân với dir.
    // "Không có số" không phải số nhỏ nhất, cũng không phải số lớn nhất; đảo chiều
    // mà lôi cả đống ô trống lên đầu bảng thì chỉ tổ che mất phần có số.
    if (a === null || b === null) {
      if (a === null && b === null) return 0;
      return a === null ? 1 : -1;
    }

    return compare(a, b) * dir;
  });
}

/* ─────────────── bộ rút giá trị theo cột ─────────────── */

/** txn_date dạng 'YYYY-MM-DD' nên so sánh chuỗi CHÍNH LÀ so sánh thời gian. */
export const FLOW_VALUE: Record<string, (r: FlowRow) => SortValue> = {
  date: (r) => r.txn_date,
  sym: (r) => r.sym,
  type: (r) => r.txn_type,
  qty: (r) => Number(r.qty),
  price: (r) => Number(r.price),
  pl: (r) => (r.row_pl === null ? null : Number(r.row_pl)),
};

/** Tên cột để nhắc lại trong lời cảnh báo — phải khớp chữ trên tiêu đề bảng. */
export const FLOW_LABELS: Record<string, string> = {
  date: 'Ngày',
  sym: 'Mã',
  type: 'Loại',
  qty: 'KL',
  price: 'Giá',
  pl: 'Lãi/lỗ dòng',
};

export const TXN_VALUE: Record<string, (t: StockTxn) => SortValue> = {
  date: (t) => t.txn_date,
  sym: (t) => t.sym,
  type: (t) => t.txn_type,
  qty: (t) => Number(t.qty),
  price: (t) => Number(t.price),
};

/**
 * "Lũy kế" (cum_pl) và "Còn nắm" (remain) là số CỘNG DỒN, backend tính theo đúng
 * trình tự thời gian. Mỗi ô mang nghĩa "tính đến hết lệnh này", nên nó chỉ đọc được
 * khi thứ tự bày ra trùng thứ tự gốc — hoặc đảo ngược đúng thứ tự gốc, vì khi đó cột
 * vẫn đơn điệu, chỉ là đọc từ dưới lên.
 *
 * Mọi thứ tự khác thì hỏng: sắp theo mã xong, lũy kế ở hàng thứ 3 đã gộp cả đóng góp
 * của những hàng đang nằm BÊN DƯỚI nó. Con số vẫn đúng với dữ liệu nhưng vô nghĩa
 * với mắt người đọc — nên hai cột đó bị ẩn thay vì để người dùng tự đoán.
 *
 * So bằng dãy id chứ không suy từ tên cột: sắp theo Ngày tăng dần tình cờ trùng thứ
 * tự gốc thì vẫn giữ được hai cột, mà không cần biết backend đã sắp theo gì.
 */
export function keepsRunningOrder(sorted: FlowRow[], original: FlowRow[]): boolean {
  if (sorted.length !== original.length) return false;
  const a = sorted.map((r) => r.id);
  const b = original.map((r) => r.id);
  const same = a.every((id, i) => id === b[i]);
  const reversed = a.every((id, i) => id === b[b.length - 1 - i]);
  return same || reversed;
}
