import { apiClient } from './client';
import type { JournalImage } from './journalImages';

export type Mood = 'greed' | 'up' | 'neutral' | 'down' | 'fear';
export type Flag = 'none' | 'warn' | 'lesson' | 'chance' | 'note';

export interface JournalEntry {
  id: string;
  mood: Mood;
  flag: Flag;
  /** DECIMAL(10,2) dạng chuỗi, hoặc null khi để trống. */
  vnindex: string | null;
  body: string;
  /** DATETIME 'Y-m-d H:i:s' do backend đóng dấu. */
  noted_at: string;
  /** Ghi chép cũ (trước khi có tính năng ảnh) không có khoá này. */
  images?: JournalImage[];
  /** null = CHƯA TỪNG sửa. Khoá vắng mặt với backend chưa áp patch sửa bài. */
  updated_at?: string | null;
}

export interface CreateJournalPayload {
  mood: Mood;
  flag: Flag;
  vnindex: string | null;
  body: string;
}

export interface JournalFilter {
  year: string;
  month: string;
  /** Chỉ có nghĩa khi cả year và month đều là giá trị cụ thể. */
  day: string;
  flag: string;
  /** Cột `mood` trong DB. Trên giao diện luôn gọi là "Cảm nhận thị trường". */
  mood: string;
}

/** months: { "2026": [8,7,5], ... } — tháng có ghi chép, giảm dần trong mỗi năm. */
export interface JournalYears {
  years: number[];
  months?: Record<string, number[]>;
}

/** Khớp PER_PAGE_DEFAULT của backend. Đổi ở đây thì đổi cả docs/patch-phan-trang-nhat-ky.md. */
export const JOURNAL_PER_PAGE = 20;

/**
 * Một trang nhật ký. Bộ lọc áp TRƯỚC khi phân trang, nên total là tổng của phần
 * đã lọc chứ không phải tổng toàn bộ sổ.
 */
export function getJournal(filter: JournalFilter, page = 1, perPage = JOURNAL_PER_PAGE) {
  const qs = new URLSearchParams();
  if (filter.year !== 'all') qs.set('year', filter.year);
  if (filter.month !== 'all') qs.set('month', filter.month);
  if (filter.flag !== 'all') qs.set('flag', filter.flag);
  if (filter.mood !== 'all') qs.set('mood', filter.mood);
  // Không gửi day khi chưa chốt năm+tháng: backend cũng bỏ qua, nhưng gửi lên thì
  // URL đọc ra như đang lọc thật, gây hiểu nhầm khi soát log.
  if (filter.day !== 'all' && filter.year !== 'all' && filter.month !== 'all') {
    qs.set('day', filter.day);
  }
  qs.set('page', String(page));
  qs.set('per_page', String(perPage));
  return apiClient.getPaged<JournalEntry>(`fin/journal?${qs.toString()}`);
}

export function getJournalYears() {
  return apiClient.get<JournalYears>('fin/journal/years');
}

/** noted_at KHÔNG có trong payload — dấu thời gian gốc không sửa được. */
export function updateJournal(id: string, payload: CreateJournalPayload) {
  return apiClient.put<{ id: string; updated_at: string }>(`fin/journal/${id}`, payload);
}

export function createJournal(payload: CreateJournalPayload) {
  return apiClient.post<{ id: string }>('fin/journal', payload);
}

export function voidJournal(id: string) {
  return apiClient.delete<{ voided: number }>(`fin/journal/${id}`);
}
