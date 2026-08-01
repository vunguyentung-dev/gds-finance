import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import {
  fetchNewsNow,
  getNews,
  setNewsFlag,
  type FetchResult,
  type NewsResponse,
} from '../../api/news';
import { formatDateTimeVN } from '../../lib/format';
import { NewsCard } from './NewsCard';
import { FeedHealthPanel } from './FeedHealthPanel';
import '../../styles/news.css';

type ScreenState = 'loading' | 'ready' | 'error' | 'forbidden';
type Scope = 'all' | 'portfolio';

function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Đã xảy ra lỗi.';
}

export function NewsScreen() {
  const [state, setState] = useState<ScreenState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  const [scope, setScope] = useState<Scope>('all');
  const [data, setData] = useState<NewsResponse | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [lastFetch, setLastFetch] = useState<FetchResult | null>(null);
  const [actionError, setActionError] = useState('');

  const load = useCallback((sc: Scope, ignore: { current: boolean }) => {
    getNews(sc).then(
      (d) => {
        if (ignore.current) return;
        setData(d);
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
    load(scope, ignore);
    return () => {
      ignore.current = true;
    };
  }, [load, scope]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setActionError('');
    try {
      const r = await fetchNewsNow();
      setLastFetch(r);
      setData(await getNews(scope));
    } catch (err) {
      setActionError(errorMessageOf(err));
    } finally {
      setRefreshing(false);
    }
  };

  const handleFlag = async (id: string, flag: 'save' | 'watch' | '') => {
    setActionError('');
    try {
      await setNewsFlag(id, flag);
      setData((d) =>
        d === null
          ? d
          : { ...d, items: d.items.map((i) => (i.id === id ? { ...i, flag: flag === '' ? null : flag } : i)) },
      );
    } catch (err) {
      setActionError(errorMessageOf(err));
    }
  };

  if (state === 'loading') {
    return (
      <div className="gf-nw-state">
        <div className="gf-nw-state-title">Đang tải tin…</div>
      </div>
    );
  }

  if (state === 'forbidden') {
    return (
      <div className="gf-nw-state">
        <div className="gf-nw-state-title">Bạn không có quyền truy cập màn này.</div>
        <div>Vui lòng liên hệ quản trị viên để được cấp quyền.</div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="gf-nw-state">
        <div className="gf-nw-state-title">Không tải được tin.</div>
        <div>{errorMessage}</div>
        <button
          type="button"
          onClick={() => {
            setState('loading');
            load(scope, { current: false });
          }}
        >
          Thử lại
        </button>
      </div>
    );
  }

  if (data === null) return null;

  const { coverage, held } = data;

  return (
    <div className="gf-nw">
      <div className="gf-nw-head">
        <div className="gf-nw-tabs">
          <button
            type="button"
            className={`gf-nw-tab${scope === 'all' ? ' on' : ''}`}
            onClick={() => setScope('all')}
          >
            Tất cả
          </button>
          <button
            type="button"
            className={`gf-nw-tab${scope === 'portfolio' ? ' on' : ''}`}
            onClick={() => setScope('portfolio')}
          >
            Danh mục của tôi
            {coverage.matched > 0 && <span className="gf-nw-count">{coverage.matched}</span>}
          </button>
        </div>

        <div className="gf-nw-meta">
          <span>
            {coverage.total} tin trong sổ
            {coverage.to && <> · mới nhất {formatDateTimeVN(coverage.to)}</>}
          </span>
          <button type="button" className="gf-nw-refresh" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Đang nạp…' : '↻ Làm mới'}
          </button>
        </div>
      </div>

      {actionError && <div className="gf-nw-err">{actionError}</div>}

      {/* Kết quả nạp: TỪNG nguồn một dòng, nguồn chết phải thấy được (13.5) */}
      {lastFetch && (
        <div className="gf-nw-fetch">
          <div className="gf-nw-fetch-title">
            Kết quả nạp lúc {formatDateTimeVN(lastFetch.as_of)}
            {lastFetch.purged > 0 && <> · dọn {lastFetch.purged} tin cũ hơn 30 ngày</>}
          </div>
          <table className="gf-nw-fetch-tbl gf-num">
            <thead>
              <tr>
                <th className="l">Nguồn</th>
                <th>HTTP</th>
                <th>Đọc được</th>
                <th>Tin mới</th>
                <th>Trùng</th>
                <th className="l">Lỗi</th>
              </tr>
            </thead>
            <tbody>
              {lastFetch.feeds.map((f) => (
                <tr key={f.url} className={f.ok ? undefined : 'bad'}>
                  <td className="l">{f.name}</td>
                  <td>{f.http ?? '—'}</td>
                  <td>{f.items}</td>
                  <td className="strong">{f.inserted}</td>
                  <td className="muted">{f.skipped_guid + f.skipped_title}</td>
                  <td className="l err">{f.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {scope === 'portfolio' && data.items.length === 0 && (
        <div className="gf-nw-empty">
          {held.length === 0 ? (
            <>
              <b>Chưa nắm mã nào.</b>
              <div>
                Tab này lọc tin theo các mã có <b>số lượng còn lại &gt; 0</b> ở màn Giao dịch. Nhập lệnh mua để dùng
                được tab này.
              </div>
            </>
          ) : (
            <>
              <b>Đang nắm {held.join(', ')} nhưng chưa có tin nào nhắc tới.</b>
              <div>
                Khớp mã bằng chuỗi đơn giản, phân biệt chữ hoa — bài viết mã sai kiểu sẽ bị sót. Thà sót còn hơn gán
                nhầm tin cho mã bạn đang nắm.
              </div>
            </>
          )}
        </div>
      )}

      {scope === 'all' && data.items.length === 0 && (
        <div className="gf-nw-empty">
          <b>Chưa có tin nào.</b>
          <div>
            Bấm <b>Làm mới</b> để nạp ngay, hoặc chờ đợt tự động (mỗi 2 giờ).
            {data.next_cron && <> Đợt kế tiếp: {formatDateTimeVN(data.next_cron)}.</>}
          </div>
        </div>
      )}

      {data.items.length > 0 && (
        <div className="gf-nw-grid">
          {data.items.map((it) => (
            <NewsCard key={it.id} item={it} onFlag={handleFlag} />
          ))}
        </div>
      )}

      <FeedHealthPanel health={data.feeds_health} nextCron={data.next_cron} />

      <div className="gf-nw-note">
        <b>Chỉ hiện tiêu đề, tóm tắt ngắn từ RSS và link về nguồn.</b> Ứng dụng không tải toàn văn bài báo. Bấm tiêu đề
        để đọc bài gốc trên trang của họ.
        <br />
        <b>Không có nhãn Tốt / Xấu / Trung tính tự động.</b> Phân loại tự động từ tiêu đề sẽ sai nhiều, mà đây là thứ
        đi vào quyết định mua bán — gán sai tệ hơn không gán. Bạn tự gắn cờ <b>Lưu</b> hoặc <b>Theo dõi</b> cho tin
        nào cần.
        <br />
        <b>Không có số liệu vĩ mô</b> (vàng, dầu, DXY, OMO). RSS chỉ cho tiêu đề và tóm tắt; các số đó cần nguồn dữ
        liệu có cấu trúc riêng. Để trống thay vì moi số từ câu văn.
      </div>
    </div>
  );
}
