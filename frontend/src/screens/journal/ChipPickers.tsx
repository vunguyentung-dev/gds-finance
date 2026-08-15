import type { Flag, Mood } from '../../api/journal';
import { flags, moods } from './constants';

/**
 * Hai hàng chip chọn cảm nhận và cờ.
 *
 * Tách ra vì khung soạn bài mới và khung sửa bài dùng y hệt nhau. Để hai bản chép
 * đôi thì sớm muộn cũng lệch — thêm một mức cảm nhận ở một chỗ mà quên chỗ kia.
 */
export function MoodPicker({ value, onChange }: { value: Mood; onChange: (m: Mood) => void }) {
  return (
    <div className="gf-jn-moods">
      {moods.map((m) => {
        const on = value === m.id;
        return (
          <button
            key={m.id}
            type="button"
            className={`gf-jn-mood${on ? ' is-on' : ''}`}
            style={on ? { background: m.color } : undefined}
            onClick={() => onChange(m.id)}
          >
            <span className="gf-jn-mood-icon">{m.icon}</span>
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

export function FlagPicker({ value, onChange }: { value: Flag; onChange: (f: Flag) => void }) {
  return (
    <div className="gf-jn-flags">
      {flags.map((f) => {
        const on = value === f.id;
        return (
          <button
            key={f.id}
            type="button"
            className={`gf-jn-flag${on ? ' is-on' : ''}`}
            style={on ? { background: f.color } : undefined}
            onClick={() => onChange(f.id)}
          >
            <span>{f.icon}</span>
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
