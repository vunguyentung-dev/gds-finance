# Patch backend — đính ảnh vào Nhật ký thị trường

> **PHẦN MÃ ĐÃ ÁP XONG** ngày 2026-08-15, nhánh `feature/ap-anh-nhat-ky-20260815`.
> Verify trên class thật: 44 OK · 0 LỆCH. `GDSFIN_VERSION` 1.15.0,
> `GDSFIN_DB_VERSION` 1.10.0, bảng `fin_journal_images` đã tạo.
> **Hai việc cấu hình Plesk ở mục 1 và 2 ĐÃ LÀM XONG** (2026-08-15), đã đo lại trên
> production: mọi đuôi ảnh dưới `uploads/gdsfin-journal/` trả 404, phần còn lại của
> site không đổi. Mục 1 đã viết lại: khối `location` KHÔNG dùng được trên Plesk,
> phải dùng `if`.

Đây là patch lớn nhất từ trước tới nay: **1 file mới**, sửa **2 file**, và **2 việc
cấu hình trên Plesk** mà không làm thì tính năng hỏng theo kiểu khó đoán.

## 0. Tóm tắt

| Việc | Cần? |
|---|---|
| Nâng `GDSFIN_DB_VERSION` 1.9.0 → **1.10.0** | **CÓ** — thêm bảng `fin_journal_images` |
| Nâng `GDSFIN_VERSION` → 1.15.0 | CÓ |
| **Cấu hình nginx trên Plesk** | **CÓ — xem mục 1** |
| **Nâng `upload_max_filesize` trên Plesk** | **CÓ — xem mục 2** |
| Migrate dữ liệu cũ | KHÔNG — ghi chép cũ đơn giản là không có ảnh |

---

## 1. Chặn truy cập thư mục ảnh — nginx, KHÔNG phải .htaccess

Bạn nói đúng: production chạy nginx qua Plesk nên `.htaccess` **hoàn toàn vô tác
dụng** — nginx không đọc file đó. Nếu chỉ thả `.htaccess` vào rồi yên tâm thì thư
mục ảnh vẫn mở toang.

### Đã cân nhắc: lưu ngoài web root?

Đó là cách chắc nhất vì không phụ thuộc cấu hình nào. Nhưng **không dùng được ở
đây**: thư mục cha của WordPress do `root` sở hữu và tiến trình PHP không ghi được
vào (đã kiểm trên máy local: `drwxr-xr-x root root`). Trên Plesk thì thư mục cha
là gốc subscription, có thể ghi được, nhưng như vậy hai môi trường sẽ chạy hai
đường dẫn khác nhau — thêm một chỗ để sai mà không ai phát hiện.

Nên: **giữ trong `uploads/` như bạn đã định, chặn bằng nginx.**

### Việc bạn cần làm trên Plesk

Plesk → **Domains** → `stoic-cohen.113-52-35-14.plesk.page` → **Apache & nginx
Settings** → ô **Additional nginx directives** → dán vào:

```nginx
if ($request_uri ~* ^/wp-content/uploads/gdsfin-journal/) { return 404; }
```

Bấm **OK / Apply**. Không cần SSH.

### KHÔNG dùng khối `location` — đã thử và không chạy

Bản đầu của patch này dùng `location ^~ /wp-content/uploads/gdsfin-journal/ { return 404; }`.
Về mặt nginx thuần thì đúng: `^~` thắng mọi location regex. Nhưng trên Plesk nó
**không có tác dụng**, và mất ba vòng mới tìm ra vì hỏng theo kiểu im lặng — Plesk
nhận ô, không báo lỗi, mà khối `location` thì không vào cấu hình.

Cách tách bạch: dán tạm `add_header X-GDSFIN-Test "ok" always;` vào **cùng ô** rồi
xem header có xuất hiện không.

| Quan sát | Kết luận |
|---|---|
| Có header, thư mục vẫn 200 | Ô có ăn — vấn đề ở khối `location` |
| Không có header | Ô không được áp (sai ô, chưa Apply, hoặc lỗi cú pháp) |

Ở đây header **có** xuất hiện trên mọi đường dẫn, kể cả file tĩnh trong chính thư
mục ảnh, mà `location` vẫn không chặn. Hai điều đó chỉ cùng đúng được nếu Plesk xử
lý riêng khối `location`. Nên chuyển sang `if` — cùng loại directive đơn với
`add_header`, thứ đã chứng minh là chạy được.

`return` bên trong `if` là một trong hai cách dùng `if` được nginx khuyến nghị,
không rơi vào các trường hợp `if` gây lỗi khó lường.

### Vì sao `if` chặn được cả file có thật

`return 404` trong `if` ở cấp server chạy ở **rewrite phase** — trước bước nginx tra
file trên đĩa. Nên nó chặn vô điều kiện, không phụ thuộc file tồn tại hay không.

Đó là điều khiến phép thử bằng một tên file bịa cũng đủ kết luận: `abc.png` không hề
tồn tại, trước khi áp thì trả 301 (rơi xuống WordPress), sau khi áp trả 404. Chỉ có
`if` giải thích được thay đổi đó, và vì nó vô điều kiện nên ảnh có thật cũng chặn y
hệt.

### Kết quả đo trên production (2026-08-15)

```
uploads/gdsfin-journal/1/abc.png      404      (mọi đuôi .png .jpg .jpeg .gif .webp)
uploads/gdsfin-journal/               404
uploads/gdsfin-journal/1/  2/  99/    404
/  ·  app.js  ·  uploads/             không đổi — 200 / 200 / 403
```

Còn một ngoại lệ vô hại: `uploads/gdsfin-journal/<uid>/index.php` vẫn trả 200, vì
`.php` đi qua location khác nên thoát khỏi `if`. Nội dung nó là 28 byte chú thích do
chính mã sinh ra. Đáng chú ý là nó được trả về dạng `application/octet-stream` chứ
không chạy qua PHP — nghĩa là thư mục uploads **không thực thi PHP**, một lớp bảo vệ
sẵn có.

### Vẫn giữ ba lớp nữa, không đặt cược vào một hàng rào

1. Tên file **ngẫu nhiên 32 ký tự hex** (`random_bytes(16)`), không dùng tên gốc —
   đoán được URL là chuyện không xảy ra.
2. Một file `index.php` rỗng trong mỗi thư mục con, chặn liệt kê nếu server nào đó
   bật autoindex.
3. Endpoint phục vụ ảnh **luôn kiểm `user_id`**, kể cả khi file bị lộ đường dẫn.

---

## 2. `upload_max_filesize` đang là 2M, spec yêu cầu 5MB

Đây là cái bẫy im lặng: PHP **vứt file trước khi mã của bạn chạy**, `$_FILES` chỉ
còn mã lỗi `UPLOAD_ERR_INI_SIZE`. Người dùng thấy "upload thất bại" mà không hiểu vì
sao, còn log thì sạch trơn.

Plesk → **Domains** → domain → **PHP Settings**:

| Tham số | Đặt thành |
|---|---|
| `upload_max_filesize` | `8M` |
| `post_max_size` | `16M` |

Để dư so với 5MB vì multipart còn phần bao ngoài, và nếu sau này cho gửi nhiều ảnh
một lượt thì `post_max_size` phải chứa được tổng.

Mã vẫn kiểm 5MB độc lập với PHP, nên đặt cao hơn không nới lỏng giới hạn nghiệp vụ.

---

## 3. Cái bẫy lớn nhất về mặt kỹ thuật: `<img src>` không gửi được nonce

Ảnh phục vụ qua REST, mà REST của WordPress xác thực bằng cookie **kèm nonce**. Thẻ
`<img>` thì chỉ gửi cookie, không gửi header `X-WP-Nonce`.

Đã đọc thẳng mã nguồn `wp-includes/rest-api.php`, hàm `rest_cookie_check_errors()`:

```php
if ( null === $nonce ) {
    // No nonce at all, so act as if it's an unauthenticated request.
    wp_set_current_user( 0 );
    return true;
}
```

Nghĩa là `<img src="/wp-json/fin/v1/fin/journal/images/5">` sẽ chạy với **user 0** →
`current_user_can('fin_view')` sai → 401. Ảnh không bao giờ hiện.

Nhưng ngay phía trên đó:

```php
if ( isset( $_REQUEST['_wpnonce'] ) ) { $nonce = $_REQUEST['_wpnonce']; }
```

`_wpnonce` trong **query string** được chấp nhận. Nên frontend dựng URL ảnh kèm
`&_wpnonce=<nonce>`. Đây là cách WordPress lõi vẫn làm, không phải mẹo.

**Hệ quả phải biết:** nonce hết hạn sau 12–24 giờ. Trang mở quá lâu thì ảnh sẽ đứt
trong khi phần còn lại vẫn chạy (các lời gọi khác dùng header, được cấp nonce mới).
Tải lại trang là hết. Không có cách nào tránh triệt để nếu vẫn phục vụ qua REST.

---

## 4. Bảng mới

Thêm vào `class-fin-journal-images.php` (mục 5), và gọi từ `gds-finance.php`.

```sql
CREATE TABLE {$p}fin_journal_images (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  journal_id  BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  file_name   VARCHAR(80)     NOT NULL,
  mime        VARCHAR(30)     NOT NULL,
  size_bytes  BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_journal (journal_id),
  KEY idx_user (user_id)
) $charset;
```

Chỉ lưu `file_name`, **không lưu đường dẫn**. Đường dẫn dựng lúc đọc từ `user_id` —
đúng như bạn yêu cầu, và đó cũng là thứ khoá chặn path traversal: dù DB có bị ghi bậy
thì `basename()` vẫn cắt sạch mọi `../`.

---

## 5. File mới `backend/includes/class-fin-journal-images.php`

```php
<?php
defined('ABSPATH') || exit;

/** Ảnh đính kèm ghi chép nhật ký. Xem docs/patch-anh-nhat-ky.md. */
class GDSFIN_Journal_Images {

    const MAX_PER_ENTRY = 5;
    const MAX_BYTES     = 5242880;          // 5MB
    const THUMB_MAX     = 1200;             // cạnh dài bản thu nhỏ
    const SUBDIR        = 'gdsfin-journal';

    /** mime -> đuôi file. Nguồn sự thật DUY NHẤT về kiểu được nhận. */
    const ALLOWED = [
        'image/jpeg' => 'jpg',
        'image/png'  => 'png',
        'image/gif'  => 'gif',
        'image/webp' => 'webp',
    ];

    private static function table() {
        global $wpdb; return $wpdb->prefix . 'fin_journal_images';
    }

    public static function create_tables() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        $p = $wpdb->prefix;
        dbDelta("CREATE TABLE {$p}fin_journal_images (
            id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            journal_id  BIGINT UNSIGNED NOT NULL,
            user_id     BIGINT UNSIGNED NOT NULL,
            file_name   VARCHAR(80)     NOT NULL,
            mime        VARCHAR(30)     NOT NULL,
            size_bytes  BIGINT UNSIGNED NOT NULL,
            created_at  DATETIME        NOT NULL,
            PRIMARY KEY  (id),
            KEY idx_journal (journal_id),
            KEY idx_user (user_id)
        ) $charset;");
    }

    /** uploads/gdsfin-journal/<uid>/ — tạo nếu chưa có, kèm index.php chặn liệt kê. */
    private static function dir_for(int $uid): string {
        $up  = wp_upload_dir();
        $dir = trailingslashit($up['basedir']) . self::SUBDIR . '/' . $uid;
        if (!file_exists($dir)) {
            wp_mkdir_p($dir);
            // Lớp phòng thủ phụ, phòng server nào đó bật autoindex.
            @file_put_contents(dirname($dir) . '/index.php', "<?php // Silence is golden.\n");
            @file_put_contents($dir . '/index.php', "<?php // Silence is golden.\n");
        }
        return $dir;
    }

    /** Tên bản thu nhỏ suy ra từ tên gốc: abc.png -> abc_t.png. */
    private static function thumb_name(string $file_name): string {
        $dot = strrpos($file_name, '.');
        return substr($file_name, 0, $dot) . '_t' . substr($file_name, $dot);
    }

    public static function register_routes() {
        $view   = fn() => current_user_can('fin_view');
        $manage = fn() => current_user_can('fin_manage');

        register_rest_route('fin/v1', '/fin/journal/(?P<id>\d+)/images', [
            'methods' => 'POST', 'callback' => [self::class, 'upload'],
            'permission_callback' => $manage,
        ]);
        register_rest_route('fin/v1', '/fin/journal/images/(?P<id>\d+)', [
            ['methods' => 'GET',    'callback' => [self::class, 'serve'],
             'permission_callback' => $view],
            ['methods' => 'DELETE', 'callback' => [self::class, 'destroy'],
             'permission_callback' => $manage],
        ]);
    }

    /* ─────────── đọc ─────────── */

    /**
     * Ảnh của NHIỀU ghi chép trong một truy vấn, trả về [journal_id => [ảnh...]].
     * index() gọi hàm này một lần cho cả trang — nếu truy vấn từng ghi chép thì
     * một trang 20 bài thành 21 truy vấn.
     */
    public static function for_journals(array $journal_ids, int $uid): array {
        global $wpdb;
        if (!$journal_ids) return [];
        $ids = implode(',', array_map('absint', $journal_ids));
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, journal_id, mime, size_bytes
               FROM " . self::table() . "
              WHERE user_id = %d AND journal_id IN ($ids)
              ORDER BY id ASC",
            $uid
        ), ARRAY_A) ?: [];

        $out = [];
        foreach ($rows as $r) {
            $out[(string) $r['journal_id']][] = [
                'id'         => (string) $r['id'],
                'mime'       => $r['mime'],
                'size_bytes' => (int) $r['size_bytes'],
            ];
        }
        return $out;
    }

    /* ─────────── ghi ─────────── */

    public static function upload(WP_REST_Request $req) {
        global $wpdb;
        $uid        = get_current_user_id();
        $journal_id = absint($req['id']);

        // Ghi chép phải là của chính mình VÀ chưa bị void.
        $owns = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$wpdb->prefix}fin_journal
              WHERE id = %d AND user_id = %d AND status = 'posted'",
            $journal_id, $uid
        ));
        if (!$owns) {
            return new WP_Error('not_found', 'Không tìm thấy ghi chép', ['status' => 404]);
        }

        $files = $req->get_file_params();
        if (empty($files['file'])) {
            return new WP_Error('no_file', 'Chưa chọn ảnh', ['status' => 400]);
        }
        $f = $files['file'];

        if (!empty($f['error'])) {
            // UPLOAD_ERR_INI_SIZE = 1: PHP đã vứt file, xem mục 2 của patch này.
            $msg = ((int) $f['error'] === UPLOAD_ERR_INI_SIZE)
                ? 'Ảnh vượt giới hạn upload của máy chủ. Báo quản trị nâng upload_max_filesize.'
                : 'Tải ảnh lên thất bại (mã ' . (int) $f['error'] . ')';
            return new WP_Error('upload_failed', $msg, ['status' => 400]);
        }

        $count = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM " . self::table() . " WHERE journal_id = %d", $journal_id
        ));
        if ($count >= self::MAX_PER_ENTRY) {
            return new WP_Error('too_many', sprintf(
                'Mỗi ghi chép tối đa %d ảnh, ghi chép này đã có %d.',
                self::MAX_PER_ENTRY, $count
            ), ['status' => 400]);
        }

        $size = (int) ($f['size'] ?? 0);
        if ($size <= 0 || $size > self::MAX_BYTES) {
            // Dấu phẩy thập phân theo lối Việt, đúng quy ước hiển thị số của dự án.
            return new WP_Error('too_big', sprintf(
                'Ảnh tối đa %d MB, ảnh này %s MB.',
                self::MAX_BYTES / 1048576, number_format($size / 1048576, 1, ',', '.')
            ), ['status' => 400]);
        }

        $tmp = $f['tmp_name'];
        if (!is_uploaded_file($tmp)) {
            return new WP_Error('bad_upload', 'Tệp không hợp lệ', ['status' => 400]);
        }

        // KIỂU FILE XÁC ĐỊNH BẰNG NỘI DUNG, không tin đuôi file hay Content-Type.
        // getimagesize: "có thật là ảnh giải mã được không".
        // finfo: mime theo magic bytes. Phải qua CẢ HAI.
        $info = @getimagesize($tmp);
        if ($info === false) {
            return new WP_Error('bad_image', 'Tệp này không phải ảnh hợp lệ', ['status' => 400]);
        }
        $finfo   = new finfo(FILEINFO_MIME_TYPE);
        $sniffed = $finfo->file($tmp);
        if (!isset(self::ALLOWED[$sniffed])) {
            return new WP_Error('bad_type', sprintf(
                'Chỉ nhận JPEG, PNG, GIF, WebP. Tệp này là %s.', $sniffed ?: 'không rõ'
            ), ['status' => 400]);
        }

        $ext   = self::ALLOWED[$sniffed];
        $base  = bin2hex(random_bytes(16));
        $name  = "$base.$ext";
        $dir   = self::dir_for($uid);
        $path  = "$dir/$name";

        if (!move_uploaded_file($tmp, $path)) {
            return new WP_Error('write_failed', 'Không ghi được ảnh lên đĩa', ['status' => 500]);
        }
        @chmod($path, 0644);

        // Bản thu nhỏ. Hỏng thì BỎ QUA, không làm hỏng cả lần upload — endpoint
        // phục vụ ảnh tự lùi về bản gốc khi không có thumb.
        $editor = wp_get_image_editor($path);
        if (!is_wp_error($editor)) {
            $editor->resize(self::THUMB_MAX, self::THUMB_MAX, false);
            $editor->save("$dir/" . self::thumb_name($name));
        }

        $wpdb->insert(self::table(), [
            'journal_id' => $journal_id,
            'user_id'    => $uid,
            'file_name'  => $name,
            'mime'       => $sniffed,
            'size_bytes' => $size,
            'created_at' => GDSFIN_Util::now_mysql(),
        ]);

        return rest_ensure_response([
            'id'         => (string) $wpdb->insert_id,
            'mime'       => $sniffed,
            'size_bytes' => $size,
        ]);
    }

    /* ─────────── phục vụ ─────────── */

    public static function serve(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $id  = absint($req['id']);

        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT user_id, file_name, mime FROM " . self::table() . " WHERE id = %d", $id
        ), ARRAY_A);

        if (!$row) {
            return new WP_Error('not_found', 'Không tìm thấy ảnh', ['status' => 404]);
        }
        // CHỦ SỞ HỮU MỚI XEM ĐƯỢC. 403 chứ không 404: người dùng hợp lệ đang cố xem
        // ảnh của người khác thì nói thẳng là không có quyền.
        if ((int) $row['user_id'] !== $uid) {
            return new WP_Error('forbidden', 'Ảnh này không thuộc về bạn', ['status' => 403]);
        }

        // basename(): chốt chặn path traversal, dù tên file do chính ta sinh ra.
        $name = basename($row['file_name']);
        $dir  = self::dir_for((int) $row['user_id']);
        $path = "$dir/$name";

        if ($req->get_param('size') === 'thumb') {
            $t = "$dir/" . self::thumb_name($name);
            if (file_exists($t)) $path = $t;      // không có thumb thì dùng bản gốc
        }
        if (!file_exists($path)) {
            return new WP_Error('gone', 'Tệp ảnh không còn trên đĩa', ['status' => 404]);
        }

        $etag = '"' . md5($name . filemtime($path) . filesize($path)) . '"';
        if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
            status_header(304);
            header('ETag: ' . $etag);
            header('Cache-Control: private, max-age=86400');
            exit;
        }

        // private: ảnh có thể chứa số dư, KHÔNG được nằm trong cache dùng chung.
        header('Content-Type: ' . $row['mime']);
        header('Content-Length: ' . filesize($path));
        header('Cache-Control: private, max-age=86400');
        header('ETag: ' . $etag);
        header('X-Content-Type-Options: nosniff');
        readfile($path);
        exit;
    }

    /* ─────────── xoá ─────────── */

    /** Xoá file trên đĩa của một hàng. Dùng chung cho xoá lẻ và xoá theo ghi chép. */
    private static function unlink_row(array $row): void {
        $dir  = self::dir_for((int) $row['user_id']);
        $name = basename($row['file_name']);
        @unlink("$dir/$name");
        @unlink("$dir/" . self::thumb_name($name));
    }

    public static function destroy(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $id  = absint($req['id']);

        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT id, user_id, file_name FROM " . self::table() . "
              WHERE id = %d AND user_id = %d",
            $id, $uid
        ), ARRAY_A);
        if (!$row) {
            return new WP_Error('not_found', 'Không tìm thấy ảnh', ['status' => 404]);
        }

        self::unlink_row($row);
        $wpdb->delete(self::table(), ['id' => $id, 'user_id' => $uid]);
        return rest_ensure_response(['deleted' => 1]);
    }

    /** Gọi khi void một ghi chép: xoá cả bản ghi ảnh LẪN file trên đĩa. */
    public static function delete_for_journal(int $journal_id, int $uid): int {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, user_id, file_name FROM " . self::table() . "
              WHERE journal_id = %d AND user_id = %d",
            $journal_id, $uid
        ), ARRAY_A) ?: [];
        foreach ($rows as $r) self::unlink_row($r);
        if ($rows) {
            $wpdb->delete(self::table(), ['journal_id' => $journal_id, 'user_id' => $uid]);
        }
        return count($rows);
    }
}
```

---

## 6. Sửa `class-fin-journal.php` — hai chỗ

### 6.1 `index()` trả kèm ảnh

Thay khối `$data = array_map(...)` bằng:

```php
        // Lấy ảnh của CẢ TRANG trong một truy vấn. Truy vấn từng ghi chép thì
        // trang 20 bài thành 21 truy vấn.
        $imgs = GDSFIN_Journal_Images::for_journals(array_column($rows, 'id'), $uid);

        $data = array_map(fn($r) => [
            'id'       => (string) $r['id'],
            'mood'     => $r['mood'],
            'flag'     => $r['flag'],
            'vnindex'  => $r['vnindex'],
            'body'     => $r['body'],
            'noted_at' => $r['noted_at'],
            'images'   => $imgs[(string) $r['id']] ?? [],
        ], $rows);
```

Ghi chép cũ không có ảnh sẽ nhận `[]` — client hiển thị bình thường.

### 6.2 `destroy()` xoá luôn ảnh

Thay thân hàm:

```php
    public static function destroy(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $id  = absint($req['id']);

        $n = $wpdb->query($wpdb->prepare(
            "UPDATE " . self::table() . " SET status = 'void'
              WHERE id = %d AND user_id = %d AND status = 'posted'",
            $id, $uid
        ));
        if (!$n) return new WP_Error('not_found', 'Không tìm thấy ghi chép', ['status' => 404]);

        // Ghi chép void mềm (giữ vết kiểm toán) nhưng ẢNH XOÁ HẲN cả DB lẫn đĩa:
        // giữ lại file ảnh của một ghi chép không ai xem được nữa chỉ tổ phình đĩa,
        // và ảnh mới là thứ có nguy cơ lộ dữ liệu nhạy cảm.
        $imgs = GDSFIN_Journal_Images::delete_for_journal($id, $uid);

        return rest_ensure_response(['voided' => (int) $n, 'images_deleted' => $imgs]);
    }
```

---

## 7. Sửa `backend/gds-finance.php` — bốn dòng

```php
define('GDSFIN_VERSION', '1.15.0');
define('GDSFIN_DB_VERSION', '1.10.0');
```

Thêm vào khối `require_once` (sau `class-fin-journal.php`):

```php
require_once GDSFIN_PATH . 'includes/class-fin-journal-images.php';
```

Thêm vào khối `plugins_loaded`, cạnh các `create_tables()` khác:

```php
        GDSFIN_Journal_Images::create_tables();
```

Thêm vào khối `rest_api_init`:

```php
add_action('rest_api_init', ['GDSFIN_Journal_Images', 'register_routes']);
```

---

## 8. Soát sau khi áp

```bash
# bảng đã tạo
... -e "SHOW TABLES LIKE '%fin_journal_images'"
... -e "SELECT option_value FROM wp_options WHERE option_name='gdsfin_db_version'"   # 1.10.0

# thư mục bị chặn (chạy trên PRODUCTION, sau khi đã dán nginx directive)
curl -sI https://<domain>/wp-content/uploads/gdsfin-journal/ | head -1    # phải 404
```

Áp xong bảo tôi, tôi chạy bảng đối chiếu kỳ vọng vs thực tế trên bảng thật: kiểu file
giả mạo, quá cỡ, quá số lượng, xem ảnh của người khác, xoá lan theo ghi chép.
