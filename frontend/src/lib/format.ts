export function formatVN(value: number, decimals = 1): string {
  const negative = value < 0;
  const [intPart, fracPart] = Math.abs(value).toFixed(decimals).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = negative ? '−' : '';
  return fracPart ? `${sign}${grouped},${fracPart}` : `${sign}${grouped}`;
}

export function toTrieu(dong: number, decimals = 1): string {
  return `${formatVN(dong / 1e6, decimals)} tr`;
}

export function formatNetTrieu(dong: number, decimals = 1): string {
  const prefix = dong >= 0 ? '+' : '';
  return `${prefix}${toTrieu(dong, decimals)}`;
}

export function formatSignedTrieu(dong: number, type: 'in' | 'out', decimals = 2): string {
  const sign = type === 'in' ? '+' : '−';
  return `${sign}${formatVN(Math.abs(dong) / 1e6, decimals)} tr`;
}

/** Giá cổ phiếu: DB lưu đồng/cp, UI hiển thị theo nghìn ₫ (98500 -> "98,5"). */
export function toNghin(dong: number, decimals = 1): string {
  return formatVN(dong / 1000, decimals);
}

/** Số triệu có dấu + khi dương (âm đã có dấu − từ formatVN). */
export function signedTrieu(dong: number, decimals = 2): string {
  const prefix = dong >= 0 ? '+' : '';
  return `${prefix}${toTrieu(dong, decimals)}`;
}

/** Khối lượng cổ phiếu: nhóm nghìn, không thập phân. */
export function toQty(qty: number): string {
  return formatVN(qty, 0);
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
