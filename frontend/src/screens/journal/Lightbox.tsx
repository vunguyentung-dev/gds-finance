import { useEffect } from 'react';
import { imageUrl } from '../../api/journalImages';

interface Props {
  /** id ảnh đang mở, null = đóng. */
  id: string | null;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

/**
 * Xem ảnh toàn màn hình. Chỉ ở đây mới tải ảnh GỐC — trong bài dùng bản thu nhỏ.
 */
export function Lightbox({ id, onClose, onPrev, onNext }: Props) {
  // Escape để đóng, mũi tên để chuyển ảnh. Gắn ở document vì tiêu điểm có thể
  // đang nằm ở bất kỳ đâu sau cú bấm mở.
  useEffect(() => {
    if (id === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev?.();
      if (e.key === 'ArrowRight') onNext?.();
    };
    document.addEventListener('keydown', onKey);
    // Khoá cuộn nền: cuộn trang phía sau lớp phủ là chuyện gây mất phương hướng.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [id, onClose, onPrev, onNext]);

  if (id === null) return null;

  return (
    <div className="gf-jn-lb" onClick={onClose} role="dialog" aria-modal="true">
      <button type="button" className="gf-jn-lb-x" onClick={onClose} title="Đóng (Esc)">
        ✕
      </button>

      {onPrev && (
        <button
          type="button"
          className="gf-jn-lb-nav prev"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          title="Ảnh trước (←)"
        >
          ‹
        </button>
      )}

      {/* stopPropagation: bấm vào chính tấm ảnh thì KHÔNG đóng, chỉ bấm ra nền mới đóng. */}
      <img
        className="gf-jn-lb-img"
        src={imageUrl(id, 'full')}
        alt=""
        onClick={(e) => e.stopPropagation()}
      />

      {onNext && (
        <button
          type="button"
          className="gf-jn-lb-nav next"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          title="Ảnh sau (→)"
        >
          ›
        </button>
      )}
    </div>
  );
}
