import { useEffect, useRef, useState } from 'react';

/**
 * Người đăng nhập + nút Đăng xuất ở góc phải Topbar.
 *
 * ĐĂNG XUẤT ĐI QUA WORDPRESS, không tự xoá cookie bằng JS: nút là một thẻ <a> trỏ tới
 * URL do `wp_logout_url()` sinh ra (đã kèm nonce của hành động log-out). Việc dọn
 * cookie, phiên và auth token là của WP.
 *
 * Có bước XÁC NHẬN vì Topbar nằm cạnh nút đổi nền, rất dễ bấm nhầm khi đang nhập dở
 * một giao dịch — form trong app không tự lưu nháp nên bấm nhầm là mất phần đã gõ.
 */

/** Site root suy từ restUrl, để fallback đúng cả khi WP nằm trong thư mục con. */
function siteRootFrom(restUrl: string | undefined): string {
  if (!restUrl) return '/';
  const i = restUrl.indexOf('/wp-json/');
  return i === -1 ? '/' : restUrl.slice(0, i + 1);
}

interface Props {
  user: string | undefined;
  logoutUrl: string | undefined;
  restUrl: string | undefined;
}

export function UserMenu({ user, logoutUrl, restUrl }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Bấm ra ngoài hoặc Esc thì đóng — hộp xác nhận không được dính lại trên màn.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const hasProper = typeof logoutUrl === 'string' && logoutUrl !== '';
  // Thiếu logout_url thì vẫn đi qua luồng logout của WP, chỉ là WP sẽ hỏi lại một lần
  // nữa vì không có nonce. Tuyệt đối không tự xoá cookie để "cho nhanh".
  const href = hasProper ? logoutUrl : `${siteRootFrom(restUrl)}wp-login.php?action=logout`;

  const name = user && user.trim() !== '' ? user : 'Người dùng';
  const initial = name.trim().charAt(0).toUpperCase();

  return (
    <div className="gf-user" ref={box}>
      <button
        type="button"
        className={`gf-user-btn${open ? ' on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Đang đăng nhập: ${name}`}
      >
        <span className="gf-user-av">{initial}</span>
        <span className="gf-user-name">{name}</span>
        <span className="gf-user-caret">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="gf-user-pop" role="dialog" aria-label="Xác nhận đăng xuất">
          <div className="gf-user-pop-head">
            <div className="gf-user-pop-name">{name}</div>
            <div className="gf-user-pop-sub">Đang đăng nhập</div>
          </div>

          <div className="gf-user-pop-warn">
            Đăng xuất sẽ rời khỏi ứng dụng. <b>Phần đang nhập dở ở các form sẽ mất</b> — app không lưu nháp. Nếu đang
            nhập giao dịch thì bấm <b>Thêm</b> trước.
          </div>

          {!hasProper && (
            <div className="gf-user-pop-note">
              Backend chưa truyền <code>logout_url</code>, nên WordPress sẽ hỏi xác nhận thêm một lần nữa. Vẫn đăng
              xuất đúng cách, chỉ mất một cú bấm.
            </div>
          )}

          <div className="gf-user-pop-acts">
            <button type="button" className="gf-user-cancel" onClick={() => setOpen(false)}>
              Ở lại
            </button>
            {/* Thẻ <a> chứ không phải fetch: để WP xử lý chuyển hướng về trang đăng nhập */}
            <a className="gf-user-out" href={href}>
              Đăng xuất
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
