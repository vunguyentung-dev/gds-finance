import type { AvailableLot } from '../../api/stock';

/**
 * Phân bổ DỰ KIẾN của chế độ tự động: lấy lần lượt từ lô rẻ nhất.
 *
 * Đây chỉ là bản xem trước để user quyết định có ghim khác đi hay không — phân bổ
 * thật do backend làm (api-spec 7.3). Chỗ này lặp lại logic được vì `lots` đã được
 * backend sắp đúng thứ tự khớp, client chỉ trừ dần chứ không tự xếp thứ tự.
 */
export function autoPreview(lots: AvailableLot[], sellQty: number): Record<string, number> {
  const out: Record<string, number> = {};
  let need = sellQty;
  for (const l of lots) {
    if (need <= 0) break;
    const take = Math.min(Number(l.qty_left), need);
    if (take > 0) out[l.buy_txn_id] = take;
    need -= take;
  }
  return out;
}
