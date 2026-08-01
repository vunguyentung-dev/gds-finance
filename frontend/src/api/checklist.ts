import { apiClient } from './client';

export type Rec = 'buy' | 'sell' | 'watch';
export type RowStatus = 'ok' | 'no' | 'na' | '';

export interface RunSummary {
  id: string;
  sym: string;
  rec: Rec;
  done_at: string | null;
  created_at: string;
}

export interface RunRow {
  row_key: string;
  row_status: RowStatus;
  val: string | null;
}

export interface RunDetail {
  id: string;
  sym: string;
  rec: Rec;
  buy_price: string | null;
  sell_price: string | null;
  sell_date: string | null;
  vnindex: string | null;
  done_at: string | null;
  created_at: string;
  rows: RunRow[];
  /** progress.total của backend chỉ đếm dòng ĐÃ LƯU, không phải tổng tiêu chí. */
  progress: { done: number; total: number };
}

export interface HeadPatch {
  rec?: Rec;
  buy_price?: string | null;
  sell_price?: string | null;
  sell_date?: string | null;
  vnindex?: string | null;
}

export function getRuns(sym?: string) {
  const q = sym ? `?sym=${encodeURIComponent(sym)}` : '';
  return apiClient.get<RunSummary[]>(`fin/checklist/runs${q}`);
}

export function getRun(id: string) {
  return apiClient.get<RunDetail>(`fin/checklist/runs/${id}`);
}

export function createRun(payload: { sym: string; rec: Rec }) {
  return apiClient.post<{ id: string }>('fin/checklist/runs', payload);
}

export function updateRun(id: string, patch: HeadPatch) {
  return apiClient.put<{ updated: number }>(`fin/checklist/runs/${id}`, patch);
}

export function putRunRows(id: string, rows: RunRow[]) {
  return apiClient.put<{ updated: number }>(`fin/checklist/runs/${id}/rows`, { rows });
}

export function completeRun(id: string) {
  return apiClient.post<{ done_at: string }>(`fin/checklist/runs/${id}/complete`, {});
}
