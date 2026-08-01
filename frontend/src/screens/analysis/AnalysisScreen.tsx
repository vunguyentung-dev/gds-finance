import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../api/client';
import { getQuotes, getSymbols, type Quote, type Symbol } from '../../api/market';
import type { ThemeName } from '../../lib/theme';
import { TradingViewWidget } from './TradingViewWidget';
import { OwnPriceStrip } from './OwnPriceStrip';
import { bareSymbol, INDEX_SHORTCUTS, isGatedExchange, resolveTvSymbol, tvChartUrl } from './tvSymbol';
import '../../styles/analysis.css';

type ScreenState = 'loading' | 'ready' | 'error' | 'forbidden';

const INTERVALS = [
  { id: 'D', label: 'Ngày' },
  { id: 'W', label: 'Tuần' },
  { id: 'M', label: 'Tháng' },
  { id: '60', label: '1 giờ' },
];

function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Đã xảy ra lỗi.';
}

interface Props {
  theme: ThemeName;
}

export function AnalysisScreen({ theme }: Props) {
  const [state, setState] = useState<ScreenState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [input, setInput] = useState('');
  const [tvSymbol, setTvSymbol] = useState<string | null>(null);
  const [interval, setInterval] = useState('D');

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  const load = useCallback((ignore: { current: boolean }) => {
    getSymbols().then(
      (syms) => {
        if (ignore.current) return;
        setSymbols(syms);
        setState('ready');
      },
      (err) => {
        if (ignore.current) return;
        if (isForbidden(err)) {
          setState('forbidden');
        } else {
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

  // BA ca khác nhau, không được gộp: mã có trong sổ / chỉ số / mã cổ phiếu chưa khai.
  // Gộp hai ca sau lại thì màn sẽ báo "FPT là chỉ số", tức nói sai về mã của người dùng.
  const bare = tvSymbol === null ? null : bareSymbol(tvSymbol);
  const isTracked = bare !== null && symbols.some((s) => s.sym.toUpperCase() === bare);
  const isIndex = tvSymbol !== null && INDEX_SHORTCUTS.some((x) => x.tv === tvSymbol);

  useEffect(() => {
    if (bare === null || !isTracked) return;
    const ignore = { current: false };
    getQuotes([bare]).then(
      (r) => {
        if (ignore.current) return;
        setQuote(r.quotes[bare] ?? null);
        setQuoteLoading(false);
      },
      () => {
        if (ignore.current) return;
        setQuote(null);
        setQuoteLoading(false);
      },
    );
    return () => {
      ignore.current = true;
    };
  }, [bare, isTracked]);

  const pick = (raw: string) => {
    const resolved = resolveTvSymbol(raw, symbols);
    setInput(raw);
    if (resolved !== null) {
      setTvSymbol(resolved);
      setQuote(null);
      setQuoteLoading(true);
    }
  };

  const pickIndex = (tv: string) => {
    setInput(tv);
    setTvSymbol(tv);
    setQuote(null);
    setQuoteLoading(false);
  };

  const chartConfig = useMemo(
    () => ({
      autosize: true,
      symbol: tvSymbol ?? '',
      interval,
      timezone: 'Asia/Ho_Chi_Minh',
      theme: theme === 'dark' ? 'dark' : 'light',
      style: '1',
      locale: 'vi_VN',
      allow_symbol_change: false,
      hide_side_toolbar: false,
      // MA theo thiết kế (biểu đồ giá + MA). Chu kỳ mặc định của study; đổi được
      // ngay trong biểu đồ, nên KHÔNG ghi "MA50" ở nhãn để không nói quá.
      studies: ['MASimple@tv-basicstudies'],
      support_host: 'https://www.tradingview.com',
    }),
    [tvSymbol, interval, theme],
  );

  const taConfig = useMemo(
    () => ({
      interval: interval === 'D' ? '1D' : interval === 'W' ? '1W' : interval === 'M' ? '1M' : '1h',
      width: '100%',
      height: '100%',
      isTransparent: true,
      symbol: tvSymbol ?? '',
      showIntervalTabs: false,
      displayMode: 'single',
      locale: 'vi_VN',
      colorTheme: theme === 'dark' ? 'dark' : 'light',
    }),
    [tvSymbol, interval, theme],
  );

  if (state === 'loading') {
    return (
      <div className="gf-an-state">
        <div className="gf-an-state-title">Đang tải danh sách mã…</div>
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div className="gf-an-state">
        <div className="gf-an-state-title">Bạn không có quyền truy cập màn này.</div>
        <div>Vui lòng liên hệ quản trị viên để được cấp quyền.</div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="gf-an-state">
        <div className="gf-an-state-title">Không tải được danh sách mã.</div>
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

  const typed = input.trim().toUpperCase();
  const unresolved = typed !== '' && resolveTvSymbol(typed, symbols) === null;

  return (
    <div className="gf-an">
      {/* Chuyện quan trọng nhất của màn này, để ngay trên cùng. */}
      <div className="gf-an-block">
        <span>⚠</span>
        <div>
          <b>TradingView không cấp phép dữ liệu HOSE / HNX / UPCOM cho widget nhúng.</b> Widget nhận đúng mã nhưng thay
          biểu đồ bằng câu “Mã giao dịch này chỉ có trên TradingView”. Đã kiểm trên hai loại widget khác nhau, trong khi
          <code>NASDAQ:AAPL</code> dựng bình thường — nên đây là giới hạn bản quyền dữ liệu, không phải lỗi tích hợp hay
          sai tên mã. Với mã Việt Nam, dùng nút <b>Mở trên TradingView</b> để xem trên chính trang của họ, nơi dữ liệu
          không bị chặn.
        </div>
      </div>

      <div className="gf-an-banner">
        <span>ⓘ</span>
        <div>
          Khối biểu đồ và chỉ báo nhúng trực tiếp từ <code>s3.tradingview.com</code>: trình duyệt của bạn gọi ra ngoài
          và TradingView biết bạn đang xem mã nào. <b>Số liệu của họ độc lập với sổ của bạn</b> — lãi/lỗ ở màn Giao dịch
          và Tổng quan vẫn tính theo giá lưu trong ứng dụng, xem khối “Giá trong sổ của bạn”.
        </div>
      </div>

      <div className="gf-an-panel">
        <div className="gf-an-pick">
          <div className="gf-an-pick-col">
            <label className="gf-an-label">Mã cổ phiếu</label>
            <input
              type="text"
              className="gf-an-fld"
              placeholder="VD: FPT hoặc HOSE:FPT"
              value={input}
              onChange={(e) => pick(e.target.value)}
            />
            {unresolved && (
              <div className="gf-an-hint err">
                Chưa xác định được sàn của <b>{typed}</b>. Thêm mã kèm sàn ở màn <b>Bảng giá</b>, hoặc gõ thẳng dạng{' '}
                <b>HOSE:{typed}</b>. Không đoán sàn giúp bạn — đoán sai thì biểu đồ là của mã khác mà không có cách nào
                biết.
              </div>
            )}
          </div>

          {symbols.length > 0 && (
            <div className="gf-an-pick-col">
              <label className="gf-an-label">Đang theo dõi</label>
              <div className="gf-an-chips">
                {symbols.map((s) => (
                  <button
                    key={s.sym}
                    type="button"
                    className={`gf-an-chip${bare === s.sym ? ' on' : ''}`}
                    onClick={() => pick(s.sym)}
                    title={`${s.name || s.sym} · ${s.exchange || 'chưa khai sàn'}`}
                  >
                    {s.sym}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="gf-an-pick-col">
            <label className="gf-an-label">Chỉ số</label>
            <div className="gf-an-chips">
              {INDEX_SHORTCUTS.map((x) => (
                <button
                  key={x.tv}
                  type="button"
                  className={`gf-an-chip${tvSymbol === x.tv ? ' on' : ''}`}
                  onClick={() => pickIndex(x.tv)}
                >
                  {x.label}
                </button>
              ))}
            </div>
          </div>

          <div className="gf-an-pick-col">
            <label className="gf-an-label">Khung thời gian</label>
            <div className="gf-an-seg">
              {INTERVALS.map((iv) => (
                <button
                  key={iv.id}
                  type="button"
                  className={`gf-an-seg-btn${interval === iv.id ? ' on' : ''}`}
                  onClick={() => setInterval(iv.id)}
                >
                  {iv.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {tvSymbol === null ? (
        <div className="gf-an-empty">
          <b>Chọn một mã để xem phân tích.</b>
          <div>
            Bấm một mã trong <b>Đang theo dõi</b>, một <b>Chỉ số</b>, hoặc gõ mã vào ô trên.
            {symbols.length === 0 && (
              <>
                {' '}
                Danh sách theo dõi đang rỗng — thêm mã ở màn <b>Bảng giá</b> để hiện ở đây.
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="gf-an-row">
            <div className="gf-an-card chart">
              <div className="gf-an-card-head">
                <div className="gf-an-card-title">
                  {tvSymbol} · Phân tích kỹ thuật
                  <span className="gf-an-badge">TradingView</span>
                </div>
                <div className="gf-an-card-actions">
                  <span className="gf-an-card-sub">Khung · {INTERVALS.find((i) => i.id === interval)?.label}</span>
                  <a
                    className="gf-an-ext"
                    href={tvChartUrl(tvSymbol)}
                    target="_blank"
                    rel="noreferrer noopener"
                    title="Mở biểu đồ trên tradingview.com — dữ liệu VN chỉ xem được ở đó"
                  >
                    Mở trên TradingView ↗
                  </a>
                </div>
              </div>

              {isGatedExchange(tvSymbol) && (
                <div className="gf-an-gated">
                  Mã sàn Việt Nam: khối dưới đây rất có thể chỉ hiện “Mã giao dịch này chỉ có trên TradingView”. Đó là
                  giới hạn bản quyền của họ, không phải lỗi của ứng dụng.
                </div>
              )}
              {/* key: đổi mã / khung / theme thì remount để widget dựng lại sạch */}
              <TradingViewWidget
                key={`chart-${tvSymbol}-${interval}-${theme}`}
                widget="advanced-chart"
                config={chartConfig}
                height={420}
                label="biểu đồ"
              />
            </div>

            <div className="gf-an-card">
              <div className="gf-an-card-head">
                <div className="gf-an-card-title">
                  Chỉ báo
                  <span className="gf-an-badge">TradingView</span>
                </div>
                <div className="gf-an-card-sub">Tín hiệu tổng hợp từ nhóm chỉ báo dao động và trung bình động</div>
              </div>
              <TradingViewWidget
                key={`ta-${tvSymbol}-${interval}-${theme}`}
                widget="technical-analysis"
                config={taConfig}
                height={420}
                label="bảng chỉ báo"
              />
            </div>
          </div>

          {isTracked ? (
            <OwnPriceStrip sym={bare ?? ''} quote={quote} loading={quoteLoading} />
          ) : (
            <div className="gf-an-own">
              <div className="gf-an-own-head">
                <div className="gf-an-own-title">Giá trong sổ của bạn</div>
              </div>
              <div className="gf-an-own-msg">
                {isIndex ? (
                  <>
                    <b>{tvSymbol}</b> là chỉ số, không phải mã cổ phiếu — ứng dụng không lưu giá cho nó, nên không có
                    gì để đối chiếu.
                  </>
                ) : (
                  <>
                    <b>{bare}</b> chưa có trong danh sách theo dõi, nên ứng dụng không lưu giá cho nó. Thêm mã ở màn{' '}
                    <b>Bảng giá</b> để đối chiếu được giá trong sổ với biểu đồ.
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <div className="gf-an-note">
        <b>Không có chỉ báo nào do ứng dụng tự tính.</b> Ứng dụng chỉ lưu <b>giá đóng cửa</b> theo phiên, không có khối
        lượng và không có dữ liệu trong phiên, nên không đủ để tính RSI, MACD hay MA cho ra số đáng tin. Thay vì hiện
        số tự tính từ dữ liệu thiếu, màn này dùng nguồn có đủ dữ liệu và ghi rõ đó là nguồn nào.
        <br />
        <b>Số RSI 61,2 và MACD +1,24 trong ảnh thiết kế là chuỗi cố định</b> viết thẳng trong HTML của prototype, không
        phải kết quả tính. Không có công thức nào để port sang.
      </div>
    </div>
  );
}
