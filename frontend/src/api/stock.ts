import { apiClient } from './client';
import type { PriceInfo } from '../lib/price';

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

/* ===================== ENGINE C — khớp lô đích danh ===================== */

/** Một lô mua bị lệnh bán ăn vào. docs/api-spec.md mục 7.5. */
export interface LotMatch {
  buy_txn_id: string;
  buy_date: string;
  qty: string;
  buy_price: string;
  /** Giá vốn 1 cp = giá mua × (1 + phí mua ngày đó). */
  unit_cost: string;
  cost_matched: string;
  pl: string;
  /** Lô đã về (T+2) tại ngày bán hay chưa. Chưa về VẪN tính lãi, chỉ gắn cờ. */
  settled: boolean;
  settle_date: string;
  /** true = user tự ghim lô này, không phải hệ thống chọn. */
  is_manual: boolean;
}

export interface RemainingLot {
  buy_txn_id: string;
  buy_date: string;
  qty: string;
  unit_cost: string;
  cost_basis: string;
}

/**
 * Phần còn nắm. BẮT BUỘC hiện kèm matched_pl (mục 7.6): khớp lô rẻ trước đẩy lô
 * giá cao ở lại danh mục, chênh lệch không mất đi mà chuyển sang đây.
 */
export interface LotRemaining {
  qty: string;
  cost_basis: string;
  market_price: string | null;
  unrealized_pl: string | null;
  price: PriceInfo | null;
  lots: RemainingLot[];
}

export interface LotDetail {
  sell_txn_id: string;
  sym: string;
  txn_date: string;
  qty: string;
  price: string;
  net_unit_price: string;
  matched_qty: string;
  unmatched_qty: string;
  matches: LotMatch[];
  matched_pl: string;
  engine: string;
  engine_note: string;
  remaining: LotRemaining;
}

export function getLotDetail(sellTxnId: string) {
  return apiClient.get<LotDetail>(`fin/stock-txns/${sellTxnId}/lots`);
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

export interface UpsertRatePayload {
  eff_date: string;
  /** Phần trăm, vd '0.15'. */
  buy_fee: string;
  sell_fee: string;
  tax: string;
}

export function upsertRate(payload: UpsertRatePayload) {
  return apiClient.post<{ id: string; upserted: 'insert' | 'update' }>('fin/rates', payload);
}

export function createStockTxn(payload: CreateTxnPayload) {
  return apiClient.post<{ id: string }>('fin/stock-txns', payload);
}

export function voidStockTxn(id: string) {
  return apiClient.delete<{ voided: number }>(`fin/stock-txns/${id}`);
}
