export function formatVN(value: number, decimals = 1): string {
  const negative = value < 0;
  const [intPart, fracPart] = Math.abs(value).toFixed(decimals).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = negative ? '−' : '';
  return fracPart ? `${sign}${grouped},${fracPart}` : `${sign}${grouped}`;
}

/**
 * Tiền: hiển thị ĐỒNG đầy đủ, không quy đổi ra "tr". Làm tròn về đồng vì đồng
 * là đơn vị nhỏ nhất — giá trị gốc trong DB vẫn giữ nguyên 4 chữ số thập phân.
 */
export function toDong(dong: number): string {
  return formatVN(dong, 0);
}

/** Tiền có dấu + khi dương (âm đã có dấu − từ formatVN): "+12.410.900". */
export function signedDong(dong: number): string {
  const prefix = dong >= 0 ? '+' : '';
  return `${prefix}${formatVN(dong, 0)}`;
}

/** Thu/chi: dấu theo loại khoản, không theo dấu của số. */
export function typedDong(dong: number, type: 'in' | 'out'): string {
  const sign = type === 'in' ? '+' : '−';
  return `${sign}${formatVN(Math.abs(dong), 0)}`;
}

/** Khối lượng cổ phiếu: nhóm nghìn, không thập phân. */
export function toQty(qty: number): string {
  return formatVN(qty, 0);
}

/** Bỏ số 0 vô nghĩa ở cuối phần thập phân: "5,00" -> "5", "1,50" -> "1,5". */
function trimDecimalZeros(s: string): string {
  return s.includes(',') ? s.replace(/,?0+$/, '') : s;
}

/**
 * Diễn giải số tiền (ĐỒNG) thành chữ để người dùng soát số 0 khi nhập:
 * 5000000 -> "5 triệu đồng", 1500000 -> "1,5 triệu đồng", 50000000000 -> "50 tỷ đồng".
 * Trả chuỗi rỗng khi chưa có gì để diễn giải.
 */
export function describeDong(dong: number): string {
  if (!Number.isFinite(dong) || dong <= 0) return '';
  const scaled = (v: number, label: string) => `${trimDecimalZeros(formatVN(v, 2))} ${label}`;
  if (dong >= 1e12) return scaled(dong / 1e12, 'nghìn tỷ đồng');
  if (dong >= 1e9) return scaled(dong / 1e9, 'tỷ đồng');
  if (dong >= 1e6) return scaled(dong / 1e6, 'triệu đồng');
  if (dong >= 1e3) return scaled(dong / 1e3, 'nghìn đồng');
  return `${formatVN(dong, 0)} đồng`;
}

export function parseVNNumber(input: string): number {
  const cleaned = input.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function formatDateVN(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
