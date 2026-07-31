import { apiClient } from './client';

export type TxnType = 'buy' | 'sell';
export type T2State = 'settled_future' | 'ok' | 'short';

export interface StockTxn {
  id: string;
  sym: string;
  txn_type: TxnType;
  txn_date: string;
  qty: string;
  price: string;
  net_price: string;
  net_value: string;
}

export interface SummaryCards {
  total_realized: string;
  total_realized_pct: string | null;
  total_net_buy: string;
  total_net_sell: string;
  held_count: number;
  total_fees: string;
}

export interface BySymRow {
  sym: string;
  shares: string;
  avg_cost: string | null;
  net_value: string;
  sold: string;
  realized: string;
  realized_pct: string | null;
}

export interface FlowRow {
  id: string;
  sym: string;
  txn_type: TxnType;
  txn_date: string;
  qty: string;
  price: string;
  settle_date: string | null;
  t2_state: T2State;
  t2_avail: string | null;
  cash: string;
  row_pl: string | null;
  cum_pl: string;
  remain: string;
}

export interface SummaryFooter {
  flow_remain: string;
  /** Engine B (FIFO) — dùng cho chân bảng timeline. */
  cum_pl: string;
  /** Engine A (bình quân gia quyền) — dùng cho thẻ đầu màn. */
  total_realized: string;
  engines_diverge: boolean;
  engines_diff: string;
}

export interface StockSummary {
  cards: SummaryCards;
  by_sym: BySymRow[];
  flow: FlowRow[];
  footer: SummaryFooter;
}

export interface RateTier {
  id: string | null;
  eff_date: string;
  buy_fee: string;
  sell_fee: string;
  tax: string;
}

export interface CreateTxnPayload {
  sym: string;
  txn_type: TxnType;
  txn_date: string;
  /** Số cổ phiếu, chuỗi số nguyên. */
  qty: string;
  /** ĐỒNG / cổ phiếu, chuỗi. */
  price: string;
}

export function getStockTxns() {
  return apiClient.get<StockTxn[]>('fin/stock-txns');
}

export function getStockSummary() {
  return apiClient.get<StockSummary>('fin/stock-summary');
}

export function getRates() {
  return apiClient.get<RateTier[]>('fin/rates');
}

export function createStockTxn(payload: CreateTxnPayload) {
  return apiClient.post<{ id: string }>('fin/stock-txns', payload);
}

export function voidStockTxn(id: string) {
  return apiClient.delete<{ voided: number }>(`fin/stock-txns/${id}`);
}
