import type { NewsItem } from '../../api/news';
import { formatDateTimeVN } from '../../lib/format';

interface Props {
  item: NewsItem;
  onFlag: (id: string, flag: 'save' | 'watch' | '') => void;
}

/** "2 giờ trước" như thiết kế; mốc quá xa thì ghi ngày cho khỏi mơ hồ. */
function relTime(iso: string | null): string {
  if (iso === null) return 'không rõ thời điểm';
  const t = new Date(iso.replace(' ', 'T') + '+07:00').getTime();
  if (Number.isNaN(t)) return iso;
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.round(h / 24);
  if (d <= 7) return `${d} ngày trước`;
  return formatDateTimeVN(iso).split(' ')[0];
}

export function NewsCard({ item, onFlag }: Props) {
  return (
    <article className={`gf-nw-card${item.flag ? ' flagged' : ''}`}>
      <div className="gf-nw-card-top">
        {/* Badge là TÊN NGUỒN, không phải chủ đề suy đoán (api-spec 13.6) */}
        <span className="gf-nw-src">{item.source}</span>
        <span className="gf-nw-time" title={item.published_at ?? item.fetched_at}>
          {relTime(item.published_at)}
        </span>
      </div>

      <a className="gf-nw-title" href={item.link} target="_blank" rel="noreferrer noopener">
        {item.title}
      </a>

      {item.summary && <p className="gf-nw-sum">{item.summary}</p>}

      <div className="gf-nw-card-foot">
        <div className="gf-nw-syms">
          {item.syms.map((s) => (
            <span key={s} className="gf-nw-sym" title="Mã bạn đang nắm, khớp trong tiêu đề hoặc tóm tắt">
              {s}
            </span>
          ))}
        </div>
        <div className="gf-nw-acts">
          <button
            type="button"
            className={`gf-nw-flag${item.flag === 'save' ? ' on' : ''}`}
            onClick={() => onFlag(item.id, item.flag === 'save' ? '' : 'save')}
          >
            Lưu
          </button>
          <button
            type="button"
            className={`gf-nw-flag${item.flag === 'watch' ? ' on' : ''}`}
            onClick={() => onFlag(item.id, item.flag === 'watch' ? '' : 'watch')}
          >
            Theo dõi
          </button>
        </div>
      </div>
    </article>
  );
}
