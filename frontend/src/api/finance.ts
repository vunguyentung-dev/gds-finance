import { apiClient } from './client';

/**
 * 'in'/'out'   = thu/chi sinh hoạt, có danh mục.
 * 'inv_in'/'inv_out' = nộp vào / rút khỏi TK chứng khoán. Đây là chuyển tiền giữa
 * hai túi của chính user, KHÔNG phải thu/chi — backend không đếm chúng vào bất kỳ
 * số nào của fin/summary. Xem docs/api-spec.md mục 14.
 */
export type EntryType = 'in' | 'out' | 'inv_in' | 'inv_out';

/** Loại có danh mục — đúng hai khoá của fin/categories. */
export type SpendType = 'in' | 'out';

export interface FinCategories {
  in: string[];
  out: string[];
}

export interface FinEntry {
  id: number;
  entry_type: EntryType;
  amount: string;
  cat: string;
  note: string | null;
  entry_date: string;
}

export interface FinMonthTotal {
  in: number;
  out: number;
}

export interface FinSummary {
  year: number;
  years: number[];
  monthly: FinMonthTotal[];
  catTotals: Record<string, number>;
  inYear: number;
  outYear: number;
  net: number;
}

export interface CreateEntryPayload {
  entry_type: EntryType;
  amount: string;
  /** Chỉ cho 'in'/'out'. Khoản đầu tư: backend tự đóng cat, client không gửi. */
  cat?: string;
  note: string;
  entry_date: string;
}

/**
 * Vốn đã bỏ vào thị trường, CỘNG DỒN TOÀN BỘ LỊCH SỬ — không lọc năm/tháng.
 * Tiền dạng chuỗi theo ĐỒNG. net = in − out, backend đảm bảo không âm.
 */
export interface Invested {
  in: string;
  out: string;
  net: string;
}

export function getCategories() {
  return apiClient.get<FinCategories>('fin/categories');
}

export function getEntries() {
  return apiClient.get<FinEntry[]>('fin/entries');
}

export function createEntry(payload: CreateEntryPayload) {
  return apiClient.post<{ id: number }>('fin/entries', payload);
}

export function deleteEntry(id: number) {
  return apiClient.delete<{ deleted: number }>(`fin/entries/${id}`);
}

export function getSummary(year?: number) {
  const qs = year ? `?year=${year}` : '';
  return apiClient.get<FinSummary>(`fin/summary${qs}`);
}

export function getInvested() {
  return apiClient.get<Invested>('fin/invested');
}
