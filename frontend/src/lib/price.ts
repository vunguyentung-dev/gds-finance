import { formatDateVN, toDong } from './format';

export type Staleness = 'current' | 'recent' | 'stale' | 'none';

/** Khối nguồn gốc giá — docs/api-spec.md mục 9.2. */
export interface PriceInfo {
  close_price: string;
  source: string;
  is_manual: boolean;
  fetched_at: string | null;
  trade_date: string;
  sessions_behind: number;
  staleness: Staleness;
}

/** `auto:ssi` -> `SSI`, `manual` -> `thủ công`. Ánh xạ ở frontend, backend không hardcode. */
export function sourceLabel(source: string): string {
  if (source === 'manual') return 'thủ công';
  const bare = source.replace(/^auto:/, '');
  if (!bare) return 'tự động';
  return bare.toUpperCase();
}

/** `2026-08-01 16:30:00` -> `01/08 16:30`; chỉ ngày -> `01/08`. */
function shortDate(sqlDate: string): string {
  const [d] = sqlDate.split(' ');
  const [, m, dd] = d.split('-');
  return `${dd}/${m}`;
}

function shortTime(sqlDateTime: string): string | null {
  const [, t = ''] = sqlDateTime.split(' ');
  return t ? t.slice(0, 5) : null;
}

/**
 * Chuỗi nguồn gốc theo mục 9.3. Ba dạng:
 *   19.000 ₫ · SSI · 01/08 16:30
 *   19.000 ₫ · thủ công · 01/08
 *   chưa có giá
 * Khi `fetched_at` rơi vào ngày KHÁC `trade_date` thì hiện cả hai để không gây nhầm.
 */
export function formatPriceWithSource(price: PriceInfo | null): string {
  if (price === null) return 'chưa có giá';

  const money = `${toDong(Number(price.close_price))} ₫`;
  const src = sourceLabel(price.source);
  const session = shortDate(price.trade_date);

  // Giá thủ công: không kèm giờ — người dùng tự nhập nên giờ không thêm thông tin.
  if (price.is_manual || !price.fetched_at) {
    return `${money} · ${src} · ${session}`;
  }

  const fetchedDay = price.fetched_at.split(' ')[0];
  const time = shortTime(price.fetched_at);

  if (fetchedDay === price.trade_date) {
    return `${money} · ${src} · ${session}${time ? ` ${time}` : ''}`;
  }
  // Lấy hôm nay giá của phiên trước -> nói rõ cả hai
  return `${money} · ${src} · phiên ${session} · lấy ${shortDate(price.fetched_at)}${time ? ` ${time}` : ''}`;
}

/** Chuỗi ngắn cho dòng phụ, không kèm số tiền. */
export function formatSourceOnly(price: PriceInfo | null): string {
  if (price === null) return 'chưa có giá';
  const full = formatPriceWithSource(price);
  return full.split(' · ').slice(1).join(' · ');
}

/** `⚠` khi cũ từ 3 phiên trở lên (mục 9.4). */
export function stalePrefix(staleness: Staleness): string {
  return staleness === 'stale' ? '⚠ ' : '';
}

/** Chữ mờ cho giá cũ hoặc chưa có. */
export function isDimmed(staleness: Staleness): boolean {
  return staleness !== 'current';
}

export function staleTooltip(price: PriceInfo | null): string | undefined {
  if (price === null) return 'Chưa có giá đóng cửa cho mã này';
  if (price.staleness === 'current') return undefined;
  const n = price.sessions_behind;
  return `Giá của phiên ${formatDateVN(price.trade_date)}, cũ ${n} phiên so với phiên gần nhất`;
}
