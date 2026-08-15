import { ApiError } from './client';

export interface JournalImage {
  id: string;
  mime: string;
  size_bytes: number;
}

function config() {
  const cfg = window.GDSFIN;
  if (!cfg) throw new ApiError(0, 'Thiếu cấu hình GDSFIN.');
  return cfg;
}

/**
 * URL cho thẻ <img>.
 *
 * Nonce đi trong QUERY STRING chứ không phải header, vì <img src> không gửi được
 * header. Không có nonce thì REST của WordPress coi request là chưa đăng nhập
 * (`wp_set_current_user(0)` trong rest_cookie_check_errors) và trả 401 — ảnh sẽ
 * không bao giờ hiện. Xem docs/patch-anh-nhat-ky.md mục 3.
 *
 * Hệ quả: nonce hết hạn sau 12-24 giờ, trang mở quá lâu thì ảnh đứt trong khi phần
 * còn lại vẫn chạy. Tải lại trang là hết.
 */
export function imageUrl(id: string, size: 'thumb' | 'full'): string {
  const { restUrl, nonce } = config();
  const qs = new URLSearchParams({ size, _wpnonce: nonce });
  return `${restUrl}fin/journal/images/${id}?${qs.toString()}`;
}

/**
 * Gửi MỘT ảnh. Dùng FormData nên KHÔNG đặt Content-Type — trình duyệt phải tự sinh
 * kèm boundary, đặt tay là hỏng phần multipart.
 */
export async function uploadImage(journalId: string, file: File): Promise<JournalImage> {
  const { restUrl, nonce } = config();
  const body = new FormData();
  body.append('file', file);

  const res = await fetch(`${restUrl}fin/journal/${journalId}/images`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-WP-Nonce': nonce },
    body,
  });

  if (!res.ok) {
    const j: unknown = await res.json().catch(() => null);
    const message =
      j && typeof j === 'object' && 'message' in j && typeof j.message === 'string'
        ? j.message
        : res.statusText;
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as JournalImage;
}

export async function deleteImage(id: string): Promise<void> {
  const { restUrl, nonce } = config();
  const res = await fetch(`${restUrl}fin/journal/images/${id}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { 'X-WP-Nonce': nonce },
  });
  if (!res.ok) throw new ApiError(res.status, 'Không xoá được ảnh');
}
