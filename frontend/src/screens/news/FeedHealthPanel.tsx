import type { FeedHealth } from '../../api/news';
import { formatDateTimeVN } from '../../lib/format';

interface Props {
  health: FeedHealth[];
  nextCron: string | null;
}

/**
 * Tình trạng từng nguồn. Nguồn lỗi KHÔNG chặn cả màn (api-spec 13.1), nên phải có chỗ
 * thấy được nguồn nào đang chết — nếu không thì tin thiếu mà không ai biết vì sao.
 */
export function FeedHealthPanel({ health, nextCron }: Props) {
  const dead = health.filter((f) => f.last_error !== null && f.last_ok_at === null);

  return (
    <div className="gf-nw-health">
      <div className="gf-nw-health-head">
        <div className="gf-nw-health-title">Nguồn tin</div>
        <div className="gf-nw-health-sub">
          Tự nạp mỗi 2 giờ{nextCron && <> · đợt kế tiếp {formatDateTimeVN(nextCron)}</>}. WP-Cron chạy nhờ có người
          truy cập, site vắng khách thì đợt nạp trễ — nút Làm mới là đường chắc chắn.
        </div>
      </div>

      {dead.length > 0 && (
        <div className="gf-nw-health-warn">
          ⚠ <b>{dead.length} nguồn đang lỗi.</b> Các nguồn còn lại vẫn nạp bình thường — một nguồn chết không chặn cả
          màn.
        </div>
      )}

      <table className="gf-nw-health-tbl">
        <thead>
          <tr>
            <th className="l">Nguồn</th>
            <th>Loại</th>
            <th>Lần nạp gần nhất</th>
            <th>Số tin</th>
            <th className="l">Lỗi gần nhất</th>
          </tr>
        </thead>
        <tbody>
          {health.map((f) => (
            <tr key={f.url}>
              <td className="l">
                <div className="gf-nw-health-name">{f.name}</div>
                <div className="gf-nw-health-url">{f.url}</div>
              </td>
              <td>
                <span className={`gf-nw-kind${f.is_default ? ' def' : ''}`}>{f.is_default ? 'mặc định' : 'của bạn'}</span>
              </td>
              <td className="gf-num">{f.last_ok_at ? formatDateTimeVN(f.last_ok_at) : <span className="na">chưa lần nào</span>}</td>
              <td className="gf-num">{f.last_items ?? <span className="na">—</span>}</td>
              <td className="l err">
                {f.last_error ? (
                  <>
                    {f.last_error}
                    {f.last_error_at && <span className="at"> · {formatDateTimeVN(f.last_error_at)}</span>}
                  </>
                ) : (
                  <span className="na">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="gf-nw-health-foot">
        Thêm hoặc bớt nguồn ở màn <b>Cài đặt</b>. Ba nguồn mặc định luôn có và không xoá được, để màn không rỗng vì xoá
        hết nguồn.
      </div>
    </div>
  );
}
