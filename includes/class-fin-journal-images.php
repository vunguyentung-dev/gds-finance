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
