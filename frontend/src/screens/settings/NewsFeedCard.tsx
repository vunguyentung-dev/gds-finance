import { useCallback, useEffect, useState } from 'react';
import { addNewsFeed, deleteNewsFeed, getNewsFeeds, type FetchResult, type NewsFeed } from '../../api/news';

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Đã xảy ra lỗi.';
}

/**
 * Quản lý nguồn RSS (api-spec 13.9).
 *
 * Ba nguồn mặc định hiện ở đây nhưng KHÔNG có nút xoá — chúng là hằng số trong code để
 * màn Tin tức không bao giờ rỗng vì user xoá hết nguồn của mình.
 */
export function NewsFeedCard() {
  const [feeds, setFeeds] = useState<NewsFeed[] | null>(null);
  const [loadError, setLoadError] = useState('');

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [probe, setProbe] = useState<FetchResult['feeds'][number] | null>(null);

  const load = useCallback((ignore: { current: boolean }) => {
    getNewsFeeds().then(
      (f) => {
        if (ignore.current) return;
        setFeeds(f);
        setLoadError('');
      },
      (err) => {
        if (ignore.current) return;
        setLoadError(errorMessageOf(err));
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

  const handleAdd = async () => {
    if (url.trim() === '') {
      setFormError('Cần nhập URL của feed RSS.');
      return;
    }
    setBusy(true);
    setFormError('');
    setProbe(null);
    try {
      const r = await addNewsFeed(name.trim(), url.trim());
      setProbe(r.probe);
      setName('');
      setUrl('');
      load({ current: false });
    } catch (err) {
      setFormError(errorMessageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setFormError('');
    try {
      await deleteNewsFeed(id);
      load({ current: false });
    } catch (err) {
      setFormError(errorMessageOf(err));
    }
  };

  return (
    <div className="gf-set-card wide">
      <div className="gf-set-title">Nguồn tin RSS</div>
      <div className="gf-set-sub">
        Màn Tin tức nạp từ các nguồn này mỗi 2 giờ. Nguồn nào lỗi thì bị bỏ qua, không chặn các nguồn còn lại.
      </div>

      <div className="gf-feed-form">
        <div>
          <label className="gf-set-label">Tên nguồn</label>
          <input
            type="text"
            className="gf-set-input"
            placeholder="Để trống sẽ lấy theo tên miền"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="gf-set-label">URL feed RSS</label>
          <input
            type="text"
            className="gf-set-input"
            placeholder="https://…/feed.rss"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <button type="button" className="gf-set-btn" onClick={handleAdd} disabled={busy}>
          {busy ? 'Đang thử…' : '+ Thêm nguồn'}
        </button>
      </div>

      {formError && <div className="gf-set-error">{formError}</div>}

      {/* Thử ngay khi thêm, để user biết nguồn dùng được hay không thay vì chờ đợt cron */}
      {probe && (
        <div className={`gf-feed-probe${probe.ok ? '' : ' bad'}`}>
          {probe.ok ? (
            <>
              ✓ Nguồn dùng được: HTTP {probe.http}, đọc được <b>{probe.items}</b> tin, thêm mới{' '}
              <b>{probe.inserted}</b>.
            </>
          ) : (
            <>
              ✕ Nguồn chưa dùng được: {probe.error ?? 'không rõ lý do'}. Nguồn vẫn được lưu — sửa URL hoặc xoá đi.
            </>
          )}
        </div>
      )}

      {loadError && <div className="gf-set-error">{loadError}</div>}

      {feeds !== null && (
        <table className="gf-set-table gf-feed-table">
          <thead>
            <tr>
              <th className="l">Nguồn</th>
              <th>Loại</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {feeds.map((f) => (
              <tr key={f.url}>
                <td className="l">
                  <div className="gf-feed-name">{f.name}</div>
                  <div className="gf-feed-url">{f.url}</div>
                </td>
                <td>
                  <span className={`gf-nw-kind${f.is_default ? ' def' : ''}`}>
                    {f.is_default ? 'mặc định' : 'của bạn'}
                  </span>
                </td>
                <td className="gf-feed-act">
                  {f.is_default ? (
                    <span className="gf-feed-lock" title="Nguồn mặc định luôn có, để màn Tin tức không bị rỗng">
                      không xoá được
                    </span>
                  ) : (
                    <button type="button" className="gf-feed-del" onClick={() => handleDelete(f.id!)}>
                      Xoá
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
