import type { Flag, Mood } from '../../api/journal';
import { flags, moods } from './constants';
import { ImageAttach } from './ImageAttach';
import { filesFromClipboard, pickImages } from './imageRules';

export interface JournalDraft {
  mood: Mood;
  flag: Flag;
  vnindex: string;
  body: string;
}

interface Props {
  draft: JournalDraft;
  submitting: boolean;
  error: string;
  onMoodChange: (mood: Mood) => void;
  onFlagChange: (flag: Flag) => void;
  onFieldChange: (key: 'vnindex' | 'body', value: string) => void;
  onSubmit: () => void;
  /** Ảnh đang chờ gửi, chưa lên máy chủ. */
  images: File[];
  onImagesChange: (files: File[]) => void;
}

export function Composer({
  draft,
  submitting,
  error,
  onMoodChange,
  onFlagChange,
  onFieldChange,
  onSubmit,
  images,
  onImagesChange,
}: Props) {
  /**
   * Dán ảnh ngay trong ô ghi chú — đây là đường vào chính, vì người dùng chụp màn
   * hình biểu đồ rồi Cmd+V thẳng vào chỗ đang gõ chứ không bấm vào vùng đính kèm.
   * Chỉ chặn sự kiện khi clipboard THỰC SỰ có ảnh, để dán chữ vẫn bình thường.
   */
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const found = filesFromClipboard(e.clipboardData?.items ?? null);
    if (found.length === 0) return;
    e.preventDefault();
    const { accepted } = pickImages(found, images.length);
    if (accepted.length) onImagesChange([...images, ...accepted]);
  };

  return (
    <div className="gf-jn-panel">
      <div className="gf-jn-title">Ghi nhận cảm nhận hôm nay</div>
      <div className="gf-jn-sub">Lưu lại tâm lý &amp; nhận định để soi lại quyết định về sau.</div>

      <label className="gf-jn-label">Cảm nhận thị trường</label>
      <div className="gf-jn-moods">
        {moods.map((m) => {
          const on = draft.mood === m.id;
          return (
            <button
              key={m.id}
              type="button"
              className={`gf-jn-mood${on ? ' is-on' : ''}`}
              style={on ? { background: m.color } : undefined}
              onClick={() => onMoodChange(m.id)}
            >
              <span className="gf-jn-mood-icon">{m.icon}</span>
              {m.label}
            </button>
          );
        })}
      </div>

      <label className="gf-jn-label">Gắn cờ</label>
      <div className="gf-jn-flags">
        {flags.map((f) => {
          const on = draft.flag === f.id;
          return (
            <button
              key={f.id}
              type="button"
              className={`gf-jn-flag${on ? ' is-on' : ''}`}
              style={on ? { background: f.color } : undefined}
              onClick={() => onFlagChange(f.id)}
            >
              <span>{f.icon}</span>
              {f.label}
            </button>
          );
        })}
      </div>

      <label className="gf-jn-label">VN-Index (tùy chọn)</label>
      <input
        type="text"
        className="gf-jn-input gf-num"
        placeholder="1.312,7"
        value={draft.vnindex}
        onChange={(e) => onFieldChange('vnindex', e.target.value)}
      />

      <label className="gf-jn-label">Ghi chú / nhận định</label>
      <textarea
        className="gf-jn-textarea"
        placeholder="Hôm nay thị trường…"
        value={draft.body}
        onChange={(e) => onFieldChange('body', e.target.value)}
        onPaste={onPaste}
      />

      <ImageAttach files={images} onChange={onImagesChange} disabled={submitting} />

      <button type="button" className="gf-jn-save" onClick={onSubmit} disabled={submitting}>
        Lưu nhật ký
      </button>

      {error && <div className="gf-jn-error">{error}</div>}
    </div>
  );
}
