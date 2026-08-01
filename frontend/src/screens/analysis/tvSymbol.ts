import type { Symbol } from '../../api/market';

/** Ba sàn VN mà TradingView dùng đúng tên này làm tiền tố. */
const SUPPORTED = ['HOSE', 'HNX', 'UPCOM'];

/**
 * Ghép mã TradingView, vd `HOSE:FPT`.
 *
 * Trả null khi chưa biết sàn — KHÔNG mặc định HOSE. Đoán sai sàn thì TradingView vẫn
 * dựng biểu đồ nhưng của mã khác hoặc rỗng, mà người xem không có cách nào biết. Cùng
 * nguyên tắc với biên độ giá ở mục 10.3.
 */
export function tvSymbolOf(sym: string, exchange: string): string | null {
  const s = sym.trim().toUpperCase();
  const ex = exchange.trim().toUpperCase();
  if (s === '') return null;
  if (!SUPPORTED.includes(ex)) return null;
  return `${ex}:${s}`;
}

/** Mã đã gõ sẵn dạng `SÀN:MÃ` thì dùng nguyên, ngược lại tra trong danh sách theo dõi. */
export function resolveTvSymbol(input: string, symbols: Symbol[]): string | null {
  const raw = input.trim().toUpperCase();
  if (raw === '') return null;
  if (raw.includes(':')) {
    const [ex, s] = raw.split(':');
    return tvSymbolOf(s ?? '', ex ?? '');
  }
  const found = symbols.find((x) => x.sym.toUpperCase() === raw);
  return found ? tvSymbolOf(found.sym, found.exchange) : null;
}

/** Phần mã trần, bỏ tiền tố sàn — để tra giá trong sổ của mình. */
export function bareSymbol(tvSymbol: string): string {
  const i = tvSymbol.indexOf(':');
  return i === -1 ? tvSymbol : tvSymbol.slice(i + 1);
}

export const INDEX_SHORTCUTS = [
  { label: 'VN-Index', tv: 'HOSE:VNINDEX' },
  { label: 'VN30', tv: 'HOSE:VN30' },
  { label: 'HNX-Index', tv: 'HNX:HNXINDEX' },
];

/** Trang biểu đồ trên chính tradingview.com — nơi dữ liệu VN xem được. */
export function tvChartUrl(tvSymbol: string): string {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`;
}

/**
 * TradingView KHÔNG cấp phép dữ liệu ba sàn VN cho widget nhúng.
 *
 * Đã kiểm 01/08/2026 trên hai loại widget khác nhau (advanced-chart và
 * mini-symbol-overview): widget nhận đúng mã — mini-symbol-overview còn hiện
 * "FPT · CÔNG TY CỔ PHẦN FPT" — nhưng thay biểu đồ bằng câu "Mã giao dịch này chỉ có
 * trên TradingView". Cùng lúc đó NASDAQ:AAPL dựng bình thường, nên đây KHÔNG phải lỗi
 * tích hợp hay sai tên mã, mà là giới hạn bản quyền dữ liệu.
 */
export function isGatedExchange(tvSymbol: string): boolean {
  const ex = tvSymbol.split(':')[0]?.toUpperCase() ?? '';
  return SUPPORTED.includes(ex);
}
