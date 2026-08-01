import { useEffect, useRef, useState } from 'react';

type Status = 'loading' | 'ready' | 'failed';

interface Props {
  /** Tên widget của TradingView, vd 'advanced-chart', 'technical-analysis'. */
  widget: string;
  config: Record<string, unknown>;
  height: number;
  /** Mô tả ngắn để câu báo lỗi nói rõ khối nào không tải được. */
  label: string;
}

const TV_HOST = 'https://s3.tradingview.com';
/** Sau khoảng này mà chưa có iframe thì coi như không tải được (chặn/offline). */
const LOAD_TIMEOUT_MS = 8000;

/**
 * Nhúng widget TradingView.
 *
 * PHỤ THUỘC NGOÀI: script và iframe tải từ s3.tradingview.com, tức trình duyệt của
 * người dùng gọi ra ngoài và TradingView biết đang xem mã nào. Không có mạng, hoặc
 * bị chặn quảng cáo / tường lửa, thì widget không hiện — nên component tự phát hiện
 * và báo, thay vì để một ô trống không giải thích.
 *
 * Component KHÔNG tự reset trạng thái khi đổi mã: cha truyền `key` để remount. Làm
 * vậy vừa gọn vừa tránh setState đồng bộ trong effect.
 */
export function TradingViewWidget({ widget, config, height, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const container = document.createElement('div');
    container.className = 'tradingview-widget-container';
    container.style.height = '100%';

    const inner = document.createElement('div');
    inner.className = 'tradingview-widget-container__widget';
    inner.style.height = '100%';
    container.appendChild(inner);

    const script = document.createElement('script');
    script.src = `${TV_HOST}/external-embedding/embed-widget-${widget}.js`;
    script.type = 'text/javascript';
    script.async = true;
    // TradingView đọc cấu hình từ nội dung text của chính thẻ script.
    script.text = JSON.stringify(config);
    script.onerror = () => setStatus('failed');
    container.appendChild(script);

    el.appendChild(container);

    // Script tải được không có nghĩa là widget dựng được (mã không tồn tại, bị chặn
    // iframe...). Chốt bằng việc CÓ iframe thật hay không.
    const poll = window.setInterval(() => {
      if (el.querySelector('iframe')) {
        setStatus('ready');
        window.clearInterval(poll);
      }
    }, 250);
    const bail = window.setTimeout(() => {
      window.clearInterval(poll);
      if (!el.querySelector('iframe')) setStatus('failed');
    }, LOAD_TIMEOUT_MS);

    return () => {
      window.clearInterval(poll);
      window.clearTimeout(bail);
      el.innerHTML = '';
    };
  }, [widget, config]);

  return (
    <div className="gf-tv" style={{ height }}>
      <div ref={host} className="gf-tv-host" style={{ height }} />

      {status !== 'ready' && (
        <div className="gf-tv-overlay">
          {status === 'loading' ? (
            <div className="gf-tv-msg">Đang tải {label} từ TradingView…</div>
          ) : (
            <div className="gf-tv-msg err">
              <b>Không tải được {label}.</b>
              <div>
                Khối này nằm ở <code>s3.tradingview.com</code>, cần Internet và không bị tường lửa hoặc tiện ích chặn
                quảng cáo ngăn lại. Số liệu của bạn trong ứng dụng không phụ thuộc khối này — phần “Giá trong sổ của
                bạn” bên dưới vẫn đúng.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
