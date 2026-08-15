import { useState } from 'react';
import { imageUrl, type JournalImage } from '../../api/journalImages';

interface Props {
  images: JournalImage[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * Ảnh hiện TRỰC TIẾP trong bài, xếp dọc.
 *
 * Dùng bản thu nhỏ (max 1200px) chứ không phải ảnh gốc: ảnh đi qua PHP chứ không
 * phải file tĩnh, nên mỗi tấm là một vòng khởi động WordPress. Ảnh gốc chỉ tải khi
 * mở lightbox.
 */
export function JournalImages({ images, onOpen, onDelete }: Props) {
  // Ghi chép cũ không có ảnh: không dựng gì cả, bài hiển thị y như trước.
  if (images.length === 0) return null;

  return (
    <div className="gf-jn-imgs">
      {images.map((img) => (
        <Shot key={img.id} img={img} onOpen={onOpen} onDelete={onDelete} />
      ))}
    </div>
  );
}

function Shot({ img, onOpen, onDelete }: { img: JournalImage } & Omit<Props, 'images'>) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  return (
    <div className={`gf-jn-img${state === 'loading' ? ' is-loading' : ''}`}>
      {/*
        Khung giữ chỗ sẵn với chiều cao tối thiểu, nên lúc ảnh về layout không nhảy.
        Tỉ lệ thật chưa biết trước (backend không trả kích thước), nên đây là chỗ
        giữ chỗ tối thiểu chứ không phải khung đúng tỉ lệ.
      */}
      {state === 'loading' && <div className="gf-jn-img-ph">Đang tải ảnh…</div>}

      {state !== 'error' ? (
        <img
          src={imageUrl(img.id, 'thumb')}
          alt=""
          // lazy: một trang 20 bài có thể hàng chục ảnh, chỉ tải khi cuộn tới.
          loading="lazy"
          decoding="async"
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
          onClick={() => onOpen(img.id)}
          title="Bấm để xem lớn"
        />
      ) : (
        <div className="gf-jn-img-err">
          Không tải được ảnh. Nếu trang đã mở lâu, tải lại trang — mã phiên dùng cho
          ảnh có hạn dùng.
        </div>
      )}

      <button
        type="button"
        className="gf-jn-img-x"
        onClick={() => onDelete(img.id)}
        title="Xoá ảnh này"
      >
        ✕
      </button>
    </div>
  );
}
