import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../api/client';
import {
  getQuoteHistory,
  getQuotes,
  getSymbols,
  type HistoryResponse,
  type Quote,
  type Symbol,
} from '../../api/market';
import type { ThemeName } from '../../lib/theme';
import { TradingViewWidget } from './TradingViewWidget';
import { OwnPriceStrip } from './OwnPriceStrip';
import { PriceChart } from './PriceChart';
import { IndicatorPanel } from './IndicatorPanel';
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

  // Biểu đồ tự dựng từ fin_quote_history — nguồn CHÍNH của màn này.
  const [hist, setHist] = useState<HistoryResponse | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [histError, setHistError] = useState('');
  const [showTv, setShowTv] = useState(false);

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
    getQuoteHistory(bare).then(
      (h) => {
        if (ignore.current) return;
        setHist(h);
        setHistError('');
        setHistLoading(false);
      },
      (err) => {
        if (ignore.current) return;
        setHist(null);
        setHistError(errorMessageOf(err));
        setHistLoading(false);
      },
    );
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
      setHist(null);
      setHistError('');
      setHistLoading(true);
    }
  };

  const pickIndex = (tv: string) => {
    setInput(tv);
    setTvSymbol(tv);
    setQuote(null);
    setQuoteLoading(false);
    setHist(null);
    setHistError('');
    setHistLoading(false);
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
          {/* NGUỒN CHÍNH: biểu đồ dựng từ sổ của mình */}
          <div className="gf-an-row">
            <div className="gf-an-card chart">
              <div className="gf-an-card-head">
                <div className="gf-an-card-title">
                  {bare} · Giá đóng cửa
                  <span className="gf-an-badge own">sổ của bạn</span>
                </div>
                <div className="gf-an-card-sub">
                  Dựng từ fin_quote_history · không nội suy phiên trống, không vẽ nến (sổ chỉ có giá đóng cửa)
                </div>
              </div>

              {!isTracked ? (
                <div className="gf-ch-empty">
                  <b>{isIndex ? `${tvSymbol} là chỉ số` : `${bare} chưa có trong danh sách theo dõi`}.</b>
                  <div>
                    {isIndex
                      ? 'Ứng dụng không lưu giá cho chỉ số, nên không dựng được biểu đồ từ sổ.'
                      : 'Thêm mã ở màn Bảng giá rồi nhập giá đóng cửa để dựng biểu đồ.'}
                  </div>
                </div>
              ) : histLoading ? (
                <div className="gf-ch-empty">Đang đọc chuỗi giá…</div>
              ) : histError !== '' ? (
                <div className="gf-ch-empty">
                  <b>Không đọc được chuỗi giá.</b>
                  <div>{histError}</div>
                </div>
              ) : hist !== null ? (
                <PriceChart points={hist.points} ma20={hist.indicators.ma20} ma50={hist.indicators.ma50} />
              ) : null}
            </div>

            {isTracked && hist !== null && !histLoading && histError === '' ? (
              <IndicatorPanel data={hist} />
            ) : (
              <div className="gf-an-card">
                <div className="gf-an-card-head">
                  <div className="gf-an-card-title">
                    Chỉ báo
                    <span className="gf-an-badge own">sổ của bạn</span>
                  </div>
                </div>
                <div className="gf-ind-why na">
                  Chỉ báo tính từ chuỗi giá đóng cửa trong sổ. Chưa có chuỗi thì chưa có chỉ báo.
                </div>
              </div>
            )}
          </div>

          {isTracked ? (
            <OwnPriceStrip sym={bare ?? ''} quote={quote} loading={quoteLoading} />
          ) : null}

          {/* NGUỒN PHỤ: TradingView, mặc định ĐÓNG vì mã VN bị chặn dữ liệu */}
          <div className="gf-an-card">
            <div className="gf-an-card-head">
              <div className="gf-an-card-title">
                {tvSymbol} · Biểu đồ TradingView
                <span className="gf-an-badge">nguồn ngoài</span>
              </div>
              <div className="gf-an-card-actions">
                <button type="button" className="gf-an-toggle" onClick={() => setShowTv((v) => !v)}>
                  {showTv ? 'Ẩn' : 'Hiện'}
                </button>
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
                Mã sàn Việt Nam: TradingView chặn dữ liệu trong widget nhúng, nên khối này chỉ hiện “Mã giao dịch này
                chỉ có trên TradingView”. Dùng nút <b>Mở trên TradingView</b> ở trên. Vì vậy khối mặc định để đóng.
              </div>
            )}

            {showTv && (
              <>
                <div className="gf-an-tvbar">
                  <span className="gf-an-card-sub">Khung · {INTERVALS.find((i) => i.id === interval)?.label}</span>
                  <div className="gf-an-seg sm">
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
                <div className="gf-an-row">
                  <TradingViewWidget
                    key={`chart-${tvSymbol}-${interval}-${theme}`}
                    widget="advanced-chart"
                    config={chartConfig}
                    height={420}
                    label="biểu đồ"
                  />
                  <TradingViewWidget
                    key={`ta-${tvSymbol}-${interval}-${theme}`}
                    widget="technical-analysis"
                    config={taConfig}
                    height={420}
                    label="bảng chỉ báo"
                  />
                </div>
              </>
            )}
          </div>
        </>
      )}

      <div className="gf-an-note">
        <b>Chỉ báo tính từ giá đóng cửa trong sổ, ở backend.</b> RSI, MACD và MA chỉ cần chuỗi giá đóng cửa — không cần
        khối lượng, không cần dữ liệu trong phiên. Cái quyết định là <b>số phiên</b>: RSI(14) cần 15 phiên, MA20 cần 20,
        MACD cần 26 và đường tín hiệu cần 34. Thiếu phiên thì ô đó hiện đúng câu “cần N phiên, đang có M” chứ không hiện
        số tính từ dữ liệu thiếu.
        <br />
        <b>Không vẽ nến và không nội suy phiên trống.</b> Sổ chỉ lưu giá đóng cửa, không có mở/cao/thấp — vẽ nến thì
        phải bịa ba trong bốn giá trị. Chỗ thiếu dữ liệu để trống, không nối thẳng qua.
        <br />
        <b>Số RSI 61,2 và MACD +1,24 trong ảnh thiết kế là chuỗi cố định</b> viết thẳng trong HTML của prototype, không
        phải kết quả tính — giống ca Trần/Sàn ở màn Bảng giá.
      </div>
    </div>
  );
}
