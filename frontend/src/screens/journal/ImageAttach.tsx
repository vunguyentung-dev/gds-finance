import { useEffect, useMemo, useRef, useState } from 'react';
import { ACCEPT_ATTR, MAX_PER_ENTRY, pickImages, rejectMessage } from './imageRules';

interface Props {
  files: File[];
  onChange: (files: File[]) => void;
  disabled: boolean;
}

/**
 * Vùng đính ảnh trong khung soạn ghi chép: dán, kéo thả, hoặc chọn file.
 *
 * Ảnh chưa gửi lên máy chủ ở bước này — ghi chép chưa tồn tại thì chưa có gì để gắn
 * vào. Giữ trong bộ nhớ, gửi sau khi lưu ghi chép xong (xem JournalScreen).
 */
export function ImageAttach({ files, onChange, disabled }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [note, setNote] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Dẫn xuất lúc render chứ không setState trong effect — đặt state trong effect
  // gây thêm một vòng render và bị eslint chặn.
  // createObjectURL giữ file trong bộ nhớ cho tới khi revoke: không dọn thì dán
  // mười ảnh chụp màn hình là giữ luôn mười ảnh dù đã bỏ chọn.
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const add = (incoming: File[]) => {
    if (disabled || incoming.length === 0) return;
    const { accepted, rejected } = pickImages(incoming, files.length);
    setNote(rejectMessage(rejected));
    if (accepted.length) onChange([...files, ...accepted]);
  };

  const remove = (i: number) => onChange(files.filter((_, k) => k !== i));

  return (
    <div className="gf-jn-attach">
      <div className="gf-jn-attach-head">
        <label className="gf-jn-label" style={{ margin: 0 }}>
          Ảnh đính kèm
        </label>
        <span className="gf-jn-attach-hint gf-num">
          {files.length} / {MAX_PER_ENTRY}
        </span>
      </div>

      {/*
        Vùng thả. onPaste đặt ở đây VÀ ở textarea (xem Composer) vì người dùng
        thường Cmd+V ngay trong ô ghi chú, không bấm vào vùng này trước.
      */}
      <div
        className={`gf-jn-drop${dragOver ? ' over' : ''}${disabled ? ' off' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          add([...e.dataTransfer.files]);
        }}
      >
        <span>Dán ảnh (Cmd+V), kéo thả vào đây, hoặc</span>
        <button
          type="button"
          className="gf-jn-attach-btn"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || files.length >= MAX_PER_ENTRY}
        >
          Chọn ảnh
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          multiple
          hidden
          onChange={(e) => {
            add([...(e.target.files ?? [])]);
            // Xoá value để chọn LẠI đúng file vừa bỏ ra vẫn kích hoạt onChange.
            e.target.value = '';
          }}
        />
      </div>

      {previews.length > 0 && (
        <div className="gf-jn-attach-list">
          {previews.map((src, i) => (
            <div key={src} className="gf-jn-attach-item">
              <img src={src} alt="" />
              <button
                type="button"
                className="gf-jn-attach-x"
                onClick={() => remove(i)}
                title="Bỏ ảnh này"
                disabled={disabled}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {note && <div className="gf-jn-attach-note">{note}</div>}
    </div>
  );
}
