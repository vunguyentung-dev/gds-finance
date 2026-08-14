import type { EntryType } from '../../api/finance';
import { toDong } from '../../lib/format';

/** Ba nhóm trên nút chọn loại. 'inv' gộp hai chiều nộp/rút vào một nút. */
export type EntryGroup = 'in' | 'out' | 'inv';

export type InvType = 'inv_in' | 'inv_out';

export function isInvType(type: EntryType): type is InvType {
  return type === 'inv_in' || type === 'inv_out';
}

export function groupOf(type: EntryType): EntryGroup {
  return isInvType(type) ? 'inv' : type;
}

/**
 * Nhãn trong sổ giao dịch. CỐ Ý không dùng chữ "Đầu tư" ở đây: CATS['out'] của
 * backend đã có sẵn một danh mục CHI tên là 'Đầu tư', và bản ghi cũ đó vẫn được
 * tính vào Chi tháng/năm. Hai thứ khác nhau thì phải khác tên, không thì sổ đọc ra
 * hai dòng giống nhau mà một dòng vào báo cáo chi, một dòng không.
 */
const INV_LABEL: Record<InvType, string> = {
  inv_in: 'Nộp vào TK',
  inv_out: 'Rút khỏi TK',
};

export function invLabel(type: InvType): string {
  return INV_LABEL[type];
}

/**
 * Màu của khoản trong sổ. Thu xanh, Chi đỏ, Đầu tư dùng --accent để không đọc
 * thành lãi hay lỗ — chuyển tiền giữa hai túi thì không có lãi lỗ nào cả.
 */
export function entryColor(type: EntryType): string {
  if (isInvType(type)) return 'var(--accent)';
  return type === 'in' ? 'var(--up)' : 'var(--down)';
}

/**
 * Dấu trước số tiền. Khoản đầu tư dùng mũi tên chỉ chiều tiền chảy, không dùng
 * +/− : tiền không sinh ra cũng không mất đi, nó chỉ đổi túi.
 */
export function entrySign(type: EntryType): string {
  switch (type) {
    case 'in':
      return '+';
    case 'out':
      return '−';
    case 'inv_in':
      return '→';
    case 'inv_out':
      return '←';
  }
}

/**
 * Vốn ròng sau khi thêm khoản đang gõ. Trả null khi chưa biết vốn ròng hiện tại
 * (endpoint fin/invested chưa có) — khi đó không chặn ở client, để backend từ chối.
 */
export function overdrawError(
  type: EntryType,
  amountDong: number,
  net: string | null,
): string | null {
  if (type !== 'inv_out' || net === null || amountDong <= 0) return null;
  if (amountDong <= Number(net)) return null;
  return `Không rút được quá vốn ròng đang có (${toDong(Number(net))} ₫).`;
}
