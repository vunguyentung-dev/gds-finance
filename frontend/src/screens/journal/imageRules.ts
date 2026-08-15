/** Giới hạn phải KHỚP với hằng trong class-fin-journal-images.php. */
export const MAX_PER_ENTRY = 5;
export const MAX_BYTES = 5 * 1024 * 1024;

export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;

/** Cho ô chọn file — chỉ là gợi ý cho hộp thoại, KHÔNG phải kiểm tra bảo mật. */
export const ACCEPT_ATTR = ALLOWED_MIME.join(',');

export interface RejectedFile {
  name: string;
  reason: string;
}

export interface PickResult {
  accepted: File[];
  rejected: RejectedFile[];
}

function mb(bytes: number): string {
  return (bytes / 1048576).toFixed(1).replace('.', ',');
}

/**
 * Lọc danh sách file người dùng vừa dán/thả/chọn.
 *
 * Đây là lớp lọc cho NHANH và cho lời báo lỗi tử tế, KHÔNG phải lớp bảo vệ:
 * `file.type` do trình duyệt suy từ đuôi file nên đổi tên là qua mặt được. Backend
 * mới là chỗ quyết định, nó đọc magic bytes bằng finfo + getimagesize.
 *
 * Không im lặng bỏ qua file nào: thứ gì bị loại đều kèm lý do để hiện lên.
 */
export function pickImages(files: File[], alreadyHave: number): PickResult {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];
  let room = MAX_PER_ENTRY - alreadyHave;

  for (const f of files) {
    if (!(ALLOWED_MIME as readonly string[]).includes(f.type)) {
      rejected.push({
        name: f.name || 'ảnh dán vào',
        reason: `không phải ảnh JPEG/PNG/GIF/WebP${f.type ? ` (${f.type})` : ''}`,
      });
      continue;
    }
    if (f.size > MAX_BYTES) {
      rejected.push({ name: f.name || 'ảnh dán vào', reason: `nặng ${mb(f.size)} MB, tối đa 5 MB` });
      continue;
    }
    if (room <= 0) {
      rejected.push({ name: f.name || 'ảnh dán vào', reason: `đã đủ ${MAX_PER_ENTRY} ảnh` });
      continue;
    }
    accepted.push(f);
    room--;
  }

  return { accepted, rejected };
}

/** Gộp các lý do từ chối thành một câu đọc được. */
export function rejectMessage(rejected: RejectedFile[]): string {
  if (rejected.length === 0) return '';
  return `Bỏ qua ${rejected.length} tệp: ` + rejected.map((r) => `${r.name} — ${r.reason}`).join('; ');
}

/**
 * Lấy file ảnh từ sự kiện dán. Dán ảnh chụp màn hình thì clipboard chỉ có item
 * kiểu file, KHÔNG có tên — nên phải đặt tên thay, không thì hiện ra chuỗi rỗng.
 */
export function filesFromClipboard(items: DataTransferItemList | null): File[] {
  if (!items) return [];
  const out: File[] = [];
  for (const it of items) {
    if (it.kind !== 'file') continue;
    const f = it.getAsFile();
    if (f) out.push(f);
  }
  return out;
}
