export type Screen =
  | 'overview'
  | 'board'
  | 'trade'
  | 'finance'
  | 'analysis'
  | 'screener'
  | 'checklist'
  | 'journal'
  | 'news'
  | 'settings';

export interface NavItem {
  id: Screen;
  label: string;
}

export const nav: NavItem[] = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'board', label: 'Bảng giá' },
  { id: 'trade', label: 'Giao dịch' },
  { id: 'finance', label: 'Tài chính cá nhân' },
  { id: 'analysis', label: 'Phân tích' },
  { id: 'screener', label: 'Bộ lọc cổ phiếu' },
  { id: 'checklist', label: 'Checklist mua/bán' },
  { id: 'journal', label: 'Nhật ký thị trường' },
  { id: 'news', label: 'Tin tức' },
  { id: 'settings', label: 'Cài đặt' },
];

/** Danh sách id màn hợp lệ — suy ra từ `nav` để không phải khai báo lại. */
export const screenIds: readonly Screen[] = nav.map((item) => item.id);

export function isScreen(value: string): value is Screen {
  return (screenIds as readonly string[]).includes(value);
}

export interface ScreenTitle {
  crumb: string;
  title: string;
}

export const titles: Record<Screen, ScreenTitle> = {
  overview: { crumb: 'Trang chủ', title: 'Tổng quan danh mục' },
  board: { crumb: 'Thị trường', title: 'Bảng giá cổ phiếu' },
  trade: { crumb: 'Giao dịch', title: 'Đặt lệnh mua/bán' },
  finance: { crumb: 'Cá nhân', title: 'Tài chính cá nhân' },
  analysis: { crumb: 'Nghiên cứu', title: 'Phân tích kỹ thuật' },
  screener: { crumb: 'Nghiên cứu', title: 'Bộ lọc cổ phiếu' },
  checklist: { crumb: 'Nghiên cứu', title: 'Checklist trước khi mua/bán' },
  journal: { crumb: 'Cá nhân', title: 'Nhật ký & cảm nhận thị trường' },
  news: { crumb: 'Thị trường', title: 'Tin tức & phân tích' },
  settings: { crumb: 'Hệ thống', title: 'Cài đặt' },
};
