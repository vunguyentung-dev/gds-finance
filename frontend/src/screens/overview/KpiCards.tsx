import type { Overview } from '../../api/overview';
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
}: {
  label: string;
  card: { value: string | null; available: boolean; reason: string | null };
  hero?: boolean;
  render: (v: string) => string;
  sub?: string;
}) {
  return (
    <div className={`gf-ov-card${hero ? ' hero' : ''}`}>
      <div className="gf-ov-card-label">{label}</div>
      {card.available && card.value !== null ? (
        <>
          <div className="gf-ov-card-num gf-num">{render(card.value)}</div>
          {sub && <div className="gf-ov-card-sub gf-num">{sub}</div>}
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
  const pct = c.last_session_pl_pct;
  const sessionSub =
    pct.available && pct.value !== null
      ? `${Number(pct.value) >= 0 ? '+' : ''}${formatVN(Number(pct.value), 2)}%`
      : undefined;

  return (
    <div className="gf-ov-cards">
      <Card label="Tổng tài sản" card={c.total_asset} hero render={(v) => toDong(Number(v))} />
      <Card
        label="Lãi/lỗ phiên gần nhất"
        card={c.last_session_pl}
        render={(v) => signedDong(Number(v))}
        sub={sessionSub}
      />
      <Card label="Tiền mặt khả dụng" card={c.cash_available} render={(v) => toDong(Number(v))} />
      <Card label="Cổ tức dự kiến / năm" card={c.dividend_year} render={(v) => toDong(Number(v))} />
    </div>
  );
}
