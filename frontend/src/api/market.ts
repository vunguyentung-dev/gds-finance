import { apiClient } from './client';
import type { PriceInfo } from '../lib/price';

export type Exchange = 'HOSE' | 'HNX' | 'UPCOM';

export interface Symbol {
  sym: string;
  name: string;
  exchange: string;
  sector: string;
  in_vn30: boolean;
}

/**
 * Biên độ một phiên. `null` khi chưa biết sàn hoặc chưa có giá tham chiếu —
 * KHÔNG đoán bằng biên của HOSE. docs/api-spec.md mục 10.
 */
export interface PriceBand {
  ceiling: string;
  floor: string;
  band_pct: string;
  tick: string;
  exchange: string;
}

/** quotes_for() của backend, mở rộng thêm biên độ cho màn Bảng giá. */
export interface Quote extends PriceInfo {
  prev_close: string | null;
  change: string | null;
  change_pct: string | null;
  /** Biên độ của CHÍNH phiên đang hiện (tính từ prev_close). */
  band: PriceBand | null;
  /** Biên độ phiên KẾ TIẾP (tính từ close_price) — số dùng để đặt lệnh. */
  next_band: PriceBand | null;
}

export interface QuotesResponse {
  as_of: string;
  last_trading_day: string;
  is_stale: boolean;
  stale_reason: string | null;
  quotes: Record<string, Quote | null>;
}

export function getSymbols() {
  return apiClient.get<Symbol[]>('fin/symbols');
}

export interface UpsertSymbolPayload {
  sym: string;
  name: string;
  exchange: Exchange;
  sector?: string;
  in_vn30?: boolean;
}

export function upsertSymbol(payload: UpsertSymbolPayload) {
  return apiClient.post<{ sym: string; upserted: string }>('fin/symbols', payload);
}

export function getQuotes(syms: string[]) {
  const q = new URLSearchParams({ syms: syms.join(',') }).toString();
  return apiClient.get<QuotesResponse>(`fin/quotes?${q}`);
}
