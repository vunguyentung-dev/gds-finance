import { apiClient } from './client';

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
  flag: string;
}

export function getJournal(filter: JournalFilter) {
  const qs = new URLSearchParams();
  if (filter.year !== 'all') qs.set('year', filter.year);
  if (filter.month !== 'all') qs.set('month', filter.month);
  if (filter.flag !== 'all') qs.set('flag', filter.flag);
  const q = qs.toString();
  return apiClient.get<JournalEntry[]>(`fin/journal${q ? `?${q}` : ''}`);
}

export function getJournalYears() {
  return apiClient.get<{ years: number[] }>('fin/journal/years');
}

export function createJournal(payload: CreateJournalPayload) {
  return apiClient.post<{ id: string }>('fin/journal', payload);
}

export function voidJournal(id: string) {
  return apiClient.delete<{ voided: number }>(`fin/journal/${id}`);
}
