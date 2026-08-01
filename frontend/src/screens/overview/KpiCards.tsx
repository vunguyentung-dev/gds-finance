import type { Overview } from '../../api/overview';
import { formatSourceOnly, isDimmed, stalePrefix } from '../../lib/price';
import { formatVN, signedDong, toDong } from '../../lib/format';

interface Props {
  ov: Overview;
}

/** Thẻ hiển thị {value, available, reason} — "không biết" khác "bằng 0" (mục 8.8). */
function Card({
  label,
  card,
  hero = false,
  render,
  sub,
  dimSub = false,
}: {
  label: string;
  card: { value: string | null; available: boolean; reason: string | null };
  hero?: boolean;
  render: (v: string) => string;
  sub?: string;
  dimSub?: boolean;
}) {
  return (
    <div className={`gf-ov-card${hero ? ' hero' : ''}`}>
      <div className="gf-ov-card-label">{label}</div>
      {card.available && card.value !== null ? (
        <>
          <div className="gf-ov-card-num gf-num">{render(card.value)}</div>
          {sub && <div className={`gf-ov-card-sub gf-num${dimSub ? ' dim' : ''}`}>{sub}</div>}
        </>
      ) : (
        <>
          <div className="gf-ov-card-na gf-num">—</div>
          {card.reason && <div className="gf-ov-card-reason">{card.reason}</div>}
        </>
      )}
    </div>
  );
}

export function KpiCards({ ov }: Props) {
  const c = ov.cards;
  /**
   * Hai thẻ phụ thuộc giá thị trường phải nói rõ giá đến từ đâu và phiên nào —
   * mục 9.1 và 9.5. Lấy nguồn của mã đầu tiên có giá; khi nhiều mã thì ghi "n nguồn".
   */
  const priced = ov.holdings.filter((h) => h.price !== null);
  const sources = new Set(priced.map((h) => h.price!.source));
  const worst = priced.some((h) => h.price!.staleness === 'stale')
    ? 'stale'
    : priced.some((h) => h.price!.staleness === 'recent')
      ? 'recent'
      : 'current';
  const priceNote =
    priced.length === 0
      ? undefined
      : sources.size === 1
        ? formatSourceOnly(priced[0].price)
        : `${sources.size} nguồn · phiên ${ov.last_trading_day.slice(8, 10)}/${ov.last_trading_day.slice(5, 7)}`;
  const pct = c.last_session_pl_pct;
  const sessionSub =
    pct.available && pct.value !== null
      ? `${Number(pct.value) >= 0 ? '+' : ''}${formatVN(Number(pct.value), 2)}%`
      : undefined;

  return (
    <div className="gf-ov-cards">
      <Card
        label="Tổng tài sản"
        card={c.total_asset}
        hero
        render={(v) => `${stalePrefix(worst)}${toDong(Number(v))}`}
        sub={priceNote}
        dimSub={isDimmed(worst)}
      />
      <Card
        label="Lãi/lỗ phiên gần nhất"
        card={c.last_session_pl}
        render={(v) => `${stalePrefix(worst)}${signedDong(Number(v))}`}
        sub={sessionSub ? `${sessionSub}${priceNote ? ` · ${priceNote}` : ''}` : priceNote}
        dimSub={isDimmed(worst)}
      />
      <Card label="Tiền mặt khả dụng" card={c.cash_available} render={(v) => toDong(Number(v))} />
      <Card label="Cổ tức dự kiến / năm" card={c.dividend_year} render={(v) => toDong(Number(v))} />
    </div>
  );
}
