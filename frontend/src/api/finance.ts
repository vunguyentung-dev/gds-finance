import { apiClient } from './client';

export type EntryType = 'in' | 'out';

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
  cat: string;
  note: string;
  entry_date: string;
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
