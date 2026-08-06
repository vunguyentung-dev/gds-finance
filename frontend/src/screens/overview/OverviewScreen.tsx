import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import { getOverview, putManualQuotes, type Overview } from '../../api/overview';
import { formatDateVN } from '../../lib/format';
import { KpiCards } from './KpiCards';
import { PortfolioChart } from './PortfolioChart';
import { SectorAlloc } from './SectorAlloc';
import { HoldingsTable } from './HoldingsTable';
import { ManualPrices, type PriceDraftRow } from './ManualPrices';
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

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [priceError, setPriceError] = useState('');
  const [priceOk, setPriceOk] = useState('');

  const load = useCallback((ignore: { current: boolean }) => {
    // Chỉ gọi fin/overview. Trước đây gọi thêm fin/quotes/gaps, nhưng HAI endpoint đó
    // định nghĩa "thiếu giá" KHÁC nhau (xem ghi chú ở phần render), giữ cả hai làm
    // nguồn cho cùng một khối UI là chỗ sinh ra bug panel bị ẩn.
    getOverview().then(
      (o) => {
        if (ignore.current) return;
        setOv(o);
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

  const handleSaveQuotes = async (rows: PriceDraftRow[]) => {
    if (!ov || rows.length === 0) return;
    const session = ov.last_trading_day;

    setSaving(true);
    setPriceError('');
    setPriceOk('');
    try {
      const res = await putManualQuotes(rows.map((r) => ({ ...r, trade_date: session })));
      // Xoá nháp rồi nạp lại overview: mọi số phụ thuộc giá (lãi/lỗ tạm tính, tổng tài
      // sản, biểu đồ, phân bổ ngành) cập nhật ngay, không cần tải lại trang. Sau khi
      // nạp lại, ô nhập tự lấy giá mới làm giá trị mặc định.
      setDrafts({});
      setOv(await getOverview());
      setPriceOk(
        `Đã lưu giá ${rows.map((r) => r.sym).join(', ')} cho phiên ${formatDateVN(session)}` +
          ` (${res.upserted} dòng).` +
          (res.warnings.length ? ` Lưu ý: ${res.warnings.join('; ')}` : ''),
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

  if (!ov) return null;

  const cov = ov.price_coverage;
  // HAI trạng thái khác nhau, trước đây bị lẫn thành một:
  //  - noPrice : chưa có giá NÀO -> mọi số phụ thuộc giá hiện "—"
  //  - stale   : có giá nhưng KHÔNG phải của phiên gần nhất -> số vẫn hiện, chỉ là cũ
  // Trộn hai cái này chính là lý do panel nhập giá bị ẩn: overview báo "không thiếu"
  // trong khi cả ba mã đều chưa có giá của phiên hiện tại.
  const noPrice = cov.missing;
  const stale = ov.holdings
    .filter((h) => h.price !== null && h.price.trade_date !== ov.last_trading_day)
    .map((h) => h.sym);

  return (
    <div className="gf-ov">
      {noPrice.length > 0 && (
        <div className="gf-ov-warn">
          <span>⚠</span>
          <div>
            <b>
              Chưa có giá nào cho {noPrice.length}/{cov.held} mã đang nắm ({noPrice.join(', ')}).
            </b>{' '}
            Các số phụ thuộc giá thị trường — tổng tài sản, giá trị danh mục, lãi/lỗ tạm tính — sẽ hiện “—” thay vì
            đoán. Giá vốn và tiền mặt vẫn chính xác.
          </div>
        </div>
      )}

      {stale.length > 0 && (
        <div className="gf-ov-warn">
          <span>⚠</span>
          <div>
            <b>
              {stale.length}/{cov.held} mã đang dùng giá của phiên cũ hơn {formatDateVN(ov.last_trading_day)} (
              {stale.join(', ')}).
            </b>{' '}
            Các số vẫn tính ra được nhưng là số cũ. Nhập giá phiên gần nhất ở khối dưới để cập nhật.
          </div>
        </div>
      )}

      {/* LUÔN hiện, không phụ thuộc còn thiếu giá hay không — nhập sai phải sửa được */}
      <ManualPrices
        holdings={ov.holdings}
        session={ov.last_trading_day}
        drafts={drafts}
        saving={saving}
        error={priceError}
        okMessage={priceOk}
        onChange={(sym, value) => setDrafts((d) => ({ ...d, [sym]: value }))}
        onSubmit={handleSaveQuotes}
      />

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
