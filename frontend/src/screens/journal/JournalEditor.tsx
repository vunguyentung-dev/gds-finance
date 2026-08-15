import { useEffect, useMemo, useRef, useState } from 'react';
import type { Flag, JournalEntry, Mood } from '../../api/journal';
import { imageUrl } from '../../api/journalImages';
import { formatVnIndex } from '../../lib/format';
import { FlagPicker, MoodPicker } from './ChipPickers';
import { ACCEPT_ATTR, MAX_PER_ENTRY, filesFromClipboard, pickImages, rejectMessage } from './imageRules';

export interface EditPayload {
  mood: Mood;
  flag: Flag;
  vnindex: string;
  body: string;
  /** Ảnh mới, chưa gửi lên máy chủ. */
  added: File[];
  /** id ảnh cũ người dùng đánh dấu bỏ. */
  removed: string[];
}

interface Props {
  entry: JournalEntry;
  saving: boolean;
  error: string;
  onSave: (payload: EditPayload) => void;
  onCancel: () => void;
}

/**
 * Sửa một ghi chép tại chỗ.
 *
 * MỌI thay đổi về ảnh chỉ thực thi khi bấm Lưu: ảnh mới giữ trong bộ nhớ, ảnh bỏ chỉ
 * được đánh dấu. Nhờ vậy bấm Huỷ là thật sự không có gì xảy ra — không file mồ côi
 * trên đĩa, và ảnh lỡ bỏ nhầm cũng quay lại.
 */
export function JournalEditor({ entry, saving, error, onSave, onCancel }: Props) {
  const [mood, setMood] = useState<Mood>(entry.mood);
  const [flag, setFlag] = useState<Flag>(entry.flag);
  const [vnindex, setVnindex] = useState(entry.vnindex === null ? '' : formatVnIndex(Number(entry.vnindex)));
  const [body, setBody] = useState(entry.body);

  const [added, setAdded] = useState<File[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const existing = entry.images ?? [];
  const kept = existing.filter((i) => !removed.includes(i.id));

  // Giới hạn 5 tính trên KẾT QUẢ CUỐI: ảnh cũ còn giữ + ảnh mới thêm. Bỏ 2 thêm 2
  // thì vẫn hợp lệ, dù trong lúc thao tác có lúc tưởng như vượt.
  const total = kept.length + added.length;

  const previews = useMemo(() => added.map((f) => URL.createObjectURL(f)), [added]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    const { accepted, rejected } = pickImages(files, total);
    setNote(rejectMessage(rejected));
    if (accepted.length) setAdded((cur) => [...cur, ...accepted]);
  };

  const toggleRemove = (id: string) =>
    setRemoved((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const dirty =
    mood !== entry.mood ||
    flag !== entry.flag ||
    body !== entry.body ||
    added.length > 0 ||
    removed.length > 0 ||
    vnindex !== (entry.vnindex === null ? '' : formatVnIndex(Number(entry.vnindex)));

  return (
    <div className="gf-jn-card gf-jn-editing">
      <div className="gf-jn-edit-head">Đang sửa ghi chép</div>

      <div className="gf-jn-edit-body">
        <label className="gf-jn-label">Cảm nhận thị trường</label>
        <MoodPicker value={mood} onChange={setMood} />

        <label className="gf-jn-label">Gắn cờ</label>
        <FlagPicker value={flag} onChange={setFlag} />

        <label className="gf-jn-label">VN-Index (tùy chọn)</label>
        <input
          type="text"
          className="gf-jn-input gf-num"
          placeholder="1.312,7"
          value={vnindex}
          onChange={(e) => setVnindex(e.target.value)}
        />

        <label className="gf-jn-label">Ghi chú / nhận định</label>
        <textarea
          className="gf-jn-textarea"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onPaste={(e) => {
            const found = filesFromClipboard(e.clipboardData?.items ?? null);
            if (found.length === 0) return;
            e.preventDefault();
            addFiles(found);
          }}
        />

        <div className="gf-jn-attach">
          <div className="gf-jn-attach-head">
            <label className="gf-jn-label" style={{ margin: 0 }}>
              Ảnh đính kèm
            </label>
            <span className="gf-jn-attach-hint gf-num">
              {total} / {MAX_PER_ENTRY}
            </span>
          </div>

          <div
            className="gf-jn-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addFiles([...e.dataTransfer.files]);
            }}
          >
            <span>Dán ảnh (Cmd+V), kéo thả vào đây, hoặc</span>
            <button
              type="button"
              className="gf-jn-attach-btn"
              onClick={() => inputRef.current?.click()}
              disabled={saving || total >= MAX_PER_ENTRY}
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
                addFiles([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
          </div>

          {(existing.length > 0 || previews.length > 0) && (
            <div className="gf-jn-attach-list">
              {/* Ảnh cũ: đánh dấu bỏ thì mờ đi chứ KHÔNG biến mất — còn bấm lại để giữ. */}
              {existing.map((img) => {
                const off = removed.includes(img.id);
                return (
                  <div key={img.id} className={`gf-jn-attach-item${off ? ' is-removed' : ''}`}>
                    <img src={imageUrl(img.id, 'thumb')} alt="" loading="lazy" />
                    <button
                      type="button"
                      className="gf-jn-attach-x"
                      onClick={() => toggleRemove(img.id)}
                      title={off ? 'Giữ lại ảnh này' : 'Bỏ ảnh này khi lưu'}
                      disabled={saving}
                    >
                      {off ? '↩' : '✕'}
                    </button>
                  </div>
                );
              })}

              {previews.map((src, i) => (
                <div key={src} className="gf-jn-attach-item is-new">
                  <img src={src} alt="" />
                  <button
                    type="button"
                    className="gf-jn-attach-x"
                    onClick={() => setAdded((cur) => cur.filter((_, k) => k !== i))}
                    title="Bỏ ảnh vừa thêm"
                    disabled={saving}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {note && <div className="gf-jn-attach-note">{note}</div>}
          {removed.length > 0 && (
            <div className="gf-jn-edit-warn">
              {removed.length} ảnh sẽ bị xoá khỏi đĩa khi bấm Lưu. Bấm ↩ để giữ lại.
            </div>
          )}
        </div>

        <div className="gf-jn-edit-actions">
          <button
            type="button"
            className="gf-jn-save"
            style={{ marginTop: 0 }}
            onClick={() => onSave({ mood, flag, vnindex, body, added, removed })}
            disabled={saving || !dirty || body.trim() === ''}
          >
            {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
          </button>
          <button type="button" className="gf-jn-edit-cancel" onClick={onCancel} disabled={saving}>
            Hủy
          </button>
          {!dirty && <span className="gf-jn-edit-hint">Chưa thay đổi gì</span>}
        </div>

        {error && <div className="gf-jn-error">{error}</div>}
      </div>
    </div>
  );
}
