import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import {
  getOverview,
  getQuoteGaps,
  putManualQuotes,
  type Overview,
  type QuoteGaps,
} from '../../api/overview';
import { formatDateVN, parseVNNumber } from '../../lib/format';
import { KpiCards } from './KpiCards';
import { PortfolioChart } from './PortfolioChart';
import { SectorAlloc } from './SectorAlloc';
import { HoldingsTable } from './HoldingsTable';
import { PriceGaps } from './PriceGaps';
import '../../styles/overview.css';

type ScreenState = 'loading' | 'ready' | 'error' | 'forbidden';

function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Đã xảy ra lỗi.';
}

export function OverviewScreen() {
  const [state, setState] = useState<ScreenState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [ov, setOv] = useState<Overview | null>(null);
  const [gaps, setGaps] = useState<QuoteGaps | null>(null);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [priceError, setPriceError] = useState('');
  const [priceOk, setPriceOk] = useState('');

  const load = useCallback((ignore: { current: boolean }) => {
    Promise.all([getOverview(), getQuoteGaps()]).then(
      ([o, g]) => {
        if (ignore.current) return;
        setOv(o);
        setGaps(g);
        setState('ready');
      },
      (err) => {
        if (ignore.current) return;
        if (isForbidden(err)) setState('forbidden');
        else {
          setErrorMessage(errorMessageOf(err));
          setState('error');
        }
      },
    );
  }, []);

  useEffect(() => {
    const ignore = { current: false };
    load(ignore);
    return () => {
      ignore.current = true;
    };
  }, [load]);

  const handleSaveQuotes = async () => {
    if (!gaps) return;
    const quotes = Object.entries(drafts)
      .map(([sym, raw]) => ({ sym, close: parseVNNumber(raw) }))
      .filter((q) => q.close > 0)
      .map((q) => ({ sym: q.sym, trade_date: gaps.last_trading_day, close: String(q.close) }));

    if (quotes.length === 0) return;

    setSaving(true);
    setPriceError('');
    setPriceOk('');
    try {
      const res = await putManualQuotes(quotes);
      setDrafts({});
      const [o, g] = await Promise.all([getOverview(), getQuoteGaps()]);
      setOv(o);
      setGaps(g);
      setPriceOk(
        `Đã lưu giá cho ${res.upserted} mã.` + (res.warnings.length ? ` Lưu ý: ${res.warnings.join('; ')}` : ''),
      );
    } catch (err) {
      setPriceError(errorMessageOf(err));
    } finally {
      setSaving(false);
    }
  };

  if (state === 'loading') {
    return (
      <div className="gf-ov-state">
        <div className="gf-ov-state-title">Đang tải dữ liệu…</div>
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div className="gf-ov-state">
        <div className="gf-ov-state-title">Bạn không có quyền truy cập màn này.</div>
        <div>Vui lòng liên hệ quản trị viên để được cấp quyền.</div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="gf-ov-state">
        <div className="gf-ov-state-title">Không tải được dữ liệu.</div>
        <div>{errorMessage}</div>
        <button
          type="button"
          onClick={() => {
            setState('loading');
            load({ current: false });
          }}
        >
          Thử lại
        </button>
      </div>
    );
  }

  if (!ov || !gaps) return null;

  const cov = ov.price_coverage;
  const missingCount = cov.missing.length;

  return (
    <div className="gf-ov">
      {missingCount > 0 && (
        <div className="gf-ov-warn">
          <span>⚠</span>
          <div>
            <b>
              Thiếu giá đóng cửa của {missingCount}/{cov.held} mã đang nắm ({cov.missing.join(', ')}).
            </b>{' '}
            Các số phụ thuộc giá thị trường — tổng tài sản, giá trị danh mục, lãi/lỗ tạm tính — sẽ hiện “—” thay vì
            đoán. Giá vốn và tiền mặt vẫn chính xác.
          </div>
        </div>
      )}

      {missingCount > 0 && (
        <PriceGaps
          gaps={gaps}
          drafts={drafts}
          saving={saving}
          error={priceError}
          okMessage={priceOk}
          onChange={(sym, value) => setDrafts((d) => ({ ...d, [sym]: value }))}
          onSubmit={handleSaveQuotes}
        />
      )}

      {missingCount === 0 && priceOk && <div className="gf-ov-ok">{priceOk}</div>}

      <KpiCards ov={ov} />

      <div className="gf-ov-row">
        <PortfolioChart points={ov.portfolio_series} coverage={ov.series_coverage} stale={ov.series_stale} />
        <SectorAlloc slices={ov.sector_alloc} pricedCount={cov.priced} />
      </div>

      <HoldingsTable rows={ov.holdings} />

      <div className="gf-ov-note">
        Giá trị và lãi/lỗ tạm tính dựa trên giá đóng cửa phiên {formatDateVN(ov.last_trading_day)}, không phải giá
        trong phiên. “Lãi/lỗ tạm tính” đã trừ phí bán ước tính để so được cùng cơ sở với lãi/lỗ đã thực hiện, còn
        “Tổng tài sản” thì chưa trừ vì chưa bán thì chưa mất phí. Cổ tức dự kiến tính theo công bố, khác với cổ tức đã
        nhận đang ghi ở màn Tài chính cá nhân.
      </div>
    </div>
  );
}
