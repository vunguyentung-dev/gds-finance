import { apiClient } from './client';

/** Thẻ KPI: phân biệt "bằng 0" với "không biết" (mục 8.8). */
export interface Card {
  value: string | null;
  available: boolean;
  reason: string | null;
}

export interface Holding {
  sym: string;
  name: string | null;
  sector: string | null;
  qty: string;
  avg_cost: string | null;
  cost_value: string;
  last: string | null;
  trade_date: string | null;
  /** Chưa trừ phí bán. */
  market_value: string | null;
  exit_fee_est: string | null;
  /** Đã trừ phí bán ước tính. */
  unrealized_pl: string | null;
  unrealized_pct: string | null;
  priced: boolean;
  price_source: string | null;
  spark: string[];
  spark_from: string | null;
  spark_to: string | null;
}

export interface SectorSlice {
  sector: string;
  value: string;
  pct: string | null;
}

export interface SeriesPoint {
  trade_date: string;
  value: string;
}

export interface CashSummary {
  opening_total: string;
  deposits: string;
  withdrawals: string;
  stock_net_buy: string;
  stock_net_sell: string;
  balance: string;
  account_count: number;
  as_of: string;
}

export interface Overview {
  as_of: string;
  last_trading_day: string;
  price_coverage: { held: number; priced: number; missing: string[] };
  cards: {
    total_asset: Card;
    last_session_pl: Card;
    last_session_pl_pct: Card;
    cash_available: Card;
    dividend_year: Card;
    realized_pl: Card;
  };
  holdings: Holding[];
  sector_alloc: SectorSlice[];
  portfolio_series: SeriesPoint[];
  series_coverage: { points: number; trading_days: number; from: string; to: string };
  cash: CashSummary;
}

export interface QuoteGap {
  sym: string;
  qty: string;
  last_known: { trade_date: string; close: string } | null;
}

export interface QuoteGaps {
  last_trading_day: string;
  missing: QuoteGap[];
}

export interface ManualQuote {
  sym: string;
  trade_date: string;
  /** ĐỒNG/cp, chuỗi. */
  close: string;
}

export function getOverview(days?: number) {
  return apiClient.get<Overview>(`fin/overview${days ? `?days=${days}` : ''}`);
}

export function getQuoteGaps() {
  return apiClient.get<QuoteGaps>('fin/quotes/gaps');
}

export function putManualQuotes(quotes: ManualQuote[]) {
  return apiClient.put<{ upserted: number; warnings: string[] }>('fin/quotes/manual', { quotes });
}
