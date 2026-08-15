import type { ReactNode } from 'react';
import type { JournalEntry } from '../../api/journal';
import { formatDateTimeVN, formatVnIndex } from '../../lib/format';
import { flagOf, moodOf } from './constants';
import { JournalImages } from './JournalImages';

interface Props {
  entries: JournalEntry[];
  onVoid: (id: string) => void;
  /** Có ít nhất một bộ lọc đang bật. */
  filtering: boolean;
  onClearFilter: () => void;
  onOpenImage: (id: string) => void;
  onDeleteImage: (id: string) => void;
  onStartEdit: (id: string) => void;
  /** Ghi chép đang được sửa — thay thẻ thường bằng khung sửa. */
  editingId: string | null;
  renderEditor: (entry: JournalEntry) => ReactNode;
}

export function JournalList({
  entries,
  onVoid,
  filtering,
  onClearFilter,
  onOpenImage,
  onDeleteImage,
  onStartEdit,
  editingId,
  renderEditor,
}: Props) {
  if (entries.length === 0) {
    // Hai lý do rỗng khác hẳn nhau: chưa ghi gì bao giờ, và lọc quá hẹp. Gộp làm
    // một câu thì người vừa lọc sẽ tưởng mất sạch dữ liệu.
    return (
      <div className="gf-jn-empty">
        {filtering ? (
          <>
            <div className="gf-jn-empty-title">Không có ghi chép nào khớp bộ lọc</div>
            <div>Thử bỏ bớt một điều kiện — chẳng hạn nới ngày về “Tất cả ngày”, hoặc đổi cảm nhận thị trường.</div>
            <button type="button" className="gf-jn-empty-btn" onClick={onClearFilter}>
              ✕ Xóa bộ lọc
            </button>
          </>
        ) : (
          <>
            <div className="gf-jn-empty-title">Chưa có ghi chép nào</div>
            <div>Ghi lại cảm nhận và nhận định ở khung phía trên để soi lại quyết định về sau.</div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="gf-jn-list">
      {entries.map((e) => {
        if (e.id === editingId) return <div key={e.id}>{renderEditor(e)}</div>;
        const mood = moodOf(e.mood);
        const flag = flagOf(e.flag);
        const hasFlag = e.flag !== 'none';
        return (
          <div key={e.id} className="gf-jn-card">
            <div className="gf-jn-card-head">
              <span className="gf-jn-card-icon">{mood.icon}</span>
              <span className="gf-jn-badge" style={{ background: mood.color }}>
                {mood.label}
              </span>
              {hasFlag && (
                <span className="gf-jn-badge" style={{ background: flag.color }}>
                  {flag.icon} {flag.label}
                </span>
              )}
              {e.vnindex !== null && (
                <span className="gf-jn-vnindex gf-num">VN-Index {formatVnIndex(Number(e.vnindex))}</span>
              )}
              <span className="gf-jn-at gf-num">{formatDateTimeVN(e.noted_at)}</span>
              {/*
                Dấu đã sửa nằm CẠNH thời gian gốc, không thay thế nó. Nhật ký ghi cảm
                nhận TẠI THỜI ĐIỂM ĐÓ; sửa được mà không để dấu vết thì ba tháng sau
                dễ vô tình viết lại lịch sử sau khi đã biết kết quả thị trường.
              */}
              {e.updated_at && (
                <span className="gf-jn-edited gf-num" title={`Sửa lần cuối ${formatDateTimeVN(e.updated_at)}`}>
                  ✎ đã sửa lúc {formatDateTimeVN(e.updated_at)}
                </span>
              )}
              <span className="gf-jn-edit" title="Sửa ghi chép" onClick={() => onStartEdit(e.id)}>
                ✎
              </span>
              <span className="gf-jn-del" title="Bỏ ghi (giữ vết kiểm toán)" onClick={() => onVoid(e.id)}>
                ✕
              </span>
            </div>
            <div className="gf-jn-body">{e.body}</div>
            <JournalImages
              images={e.images ?? []}
              onOpen={onOpenImage}
              onDelete={onDeleteImage}
            />
          </div>
        );
      })}
    </div>
  );
}
