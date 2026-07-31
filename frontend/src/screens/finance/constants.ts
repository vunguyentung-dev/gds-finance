const catColors: Record<string, string> = {
  'Mua sắm': 'oklch(0.62 0.15 300)',
  'Đồ dùng thiết yếu': 'oklch(0.6 0.14 200)',
  'Đầu tư': 'var(--accent)',
  'Ăn uống': 'oklch(0.7 0.14 60)',
  'Di chuyển': 'oklch(0.65 0.13 160)',
  'Hóa đơn': 'oklch(0.6 0.14 30)',
  Khác: 'var(--muted2)',
};

export function categoryColor(cat: string): string {
  return catColors[cat] ?? 'var(--muted2)';
}
