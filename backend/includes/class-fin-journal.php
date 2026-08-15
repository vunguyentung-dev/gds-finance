<?php
defined('ABSPATH') || exit;

/** Module Nhật ký thị trường. Xem docs/api-spec.md mục 5. */
class GDSFIN_Journal {

    const MOODS = ['greed', 'up', 'neutral', 'down', 'fear'];      // gốc dòng 1308-1313
    const FLAGS = ['none', 'warn', 'lesson', 'chance', 'note'];    // gốc dòng 1316-1321

    public static function create_tables() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        $p = $wpdb->prefix;

        dbDelta("CREATE TABLE {$p}fin_journal (
            id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id    BIGINT UNSIGNED NOT NULL,
            mood       VARCHAR(10)     NOT NULL,
            flag       VARCHAR(10)     NOT NULL DEFAULT 'none',
            vnindex    DECIMAL(10,2)   NULL,
            body       TEXT            NOT NULL,
            noted_at   DATETIME        NOT NULL,
            status     VARCHAR(15)     NOT NULL DEFAULT 'posted',
            created_at DATETIME        NOT NULL,
            PRIMARY KEY  (id),
            KEY idx_user_noted (user_id, status, noted_at)
        ) $charset;");
    }

    private static function table() { global $wpdb; return $wpdb->prefix . 'fin_journal'; }

    public static function register_routes() {
        $view   = fn() => current_user_can('fin_view');
        $manage = fn() => current_user_can('fin_manage');

        register_rest_route('fin/v1', '/fin/journal', [
            ['methods' => 'GET',  'callback' => [self::class, 'index'],  'permission_callback' => $view],
            ['methods' => 'POST', 'callback' => [self::class, 'store'],  'permission_callback' => $manage],
        ]);
        register_rest_route('fin/v1', '/fin/journal/years', [
            'methods' => 'GET', 'callback' => [self::class, 'years'], 'permission_callback' => $view,
        ]);
        register_rest_route('fin/v1', '/fin/journal/(?P<id>\d+)', [
            'methods' => 'DELETE', 'callback' => [self::class, 'destroy'], 'permission_callback' => $manage,
        ]);
    }

    /** Số bản ghi mỗi trang khi client không nói gì, và trần cứng. */
    const PER_PAGE_DEFAULT = 20;
    const PER_PAGE_MAX     = 50;

    public static function index(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $t   = self::table();

        // Bộ lọc dựng MỘT LẦN, dùng cho cả đếm lẫn lấy dữ liệu. Viết hai câu riêng rồi
        // sửa một bên quên bên kia là lỗi kinh điển: X-WP-Total báo 137 trong khi bộ
        // lọc chỉ có 12 dòng, client tưởng còn trang nên bấm mãi vào khoảng không.
        $where = "WHERE user_id = %d AND status = 'posted'";
        $args  = [$uid];
        if ($y = absint($req->get_param('year')))  { $where .= " AND YEAR(noted_at) = %d";  $args[] = $y; }
        if ($m = absint($req->get_param('month'))) { $where .= " AND MONTH(noted_at) = %d"; $args[] = $m; }
        $flag = (string) $req->get_param('flag');
        if ($flag !== '' && in_array($flag, self::FLAGS, true)) { $where .= " AND flag = %s"; $args[] = $flag; }

        // Ngày chỉ có nghĩa khi đã chốt CẢ năm lẫn tháng. "Ngày 15" mà không nói
        // tháng nào thì khớp ngày 15 của mọi tháng mọi năm — gần như chắc chắn không
        // phải ý người dùng, nên bỏ qua thay vì lọc ra một tập vô nghĩa.
        $day = absint($req->get_param('day'));
        if ($day >= 1 && $day <= 31 && $y && $m) {
            $where .= " AND DAY(noted_at) = %d";
            $args[] = $day;
        }

        // Sai giá trị thì BỎ QUA, không báo lỗi — giống hệt cách flag đang xử lý.
        // Một tham số lọc rác không nên làm hỏng cả yêu cầu.
        $mood = (string) $req->get_param('mood');
        if ($mood !== '' && in_array($mood, self::MOODS, true)) {
            $where .= " AND mood = %s";
            $args[] = $mood;
        }

        // (int) chứ KHÔNG phải absint(): absint() lấy TRỊ TUYỆT ĐỐI, nên page=-5 sẽ
        // thành trang 5 và per_page=-3 thành 3 dòng — âm thầm sai chứ không báo lỗi.
        // (int) cho -5 -> -5, 'abc' -> 0, '2.9' -> 2; tất cả rơi đúng vào nhánh dưới.
        $page = (int) $req->get_param('page');
        if ($page < 1) $page = 1;

        $per = $req->get_param('per_page');
        $per = ($per === null || $per === '') ? self::PER_PAGE_DEFAULT : (int) $per;
        if ($per < 1)                  $per = self::PER_PAGE_DEFAULT;
        if ($per > self::PER_PAGE_MAX) $per = self::PER_PAGE_MAX;

        $total = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM $t $where", ...$args));
        $pages = $total > 0 ? (int) ceil($total / $per) : 0;

        // LIMIT/OFFSET đi qua prepare() với %d, không nối chuỗi — đừng tạo tiền lệ.
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, mood, flag, vnindex, body, noted_at
               FROM $t $where
              ORDER BY noted_at DESC, id DESC
              LIMIT %d OFFSET %d",
            ...array_merge($args, [$per, ($page - 1) * $per])
        ), ARRAY_A) ?: [];

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

        // Header chuẩn WordPress, giống cách wp/v2 trả về.
        $res = rest_ensure_response($data);
        $res->header('X-WP-Total', (string) $total);
        $res->header('X-WP-TotalPages', (string) $pages);
        return $res;
    }

    public static function years(WP_REST_Request $req) {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT DISTINCT YEAR(noted_at) y, MONTH(noted_at) m
               FROM " . self::table() . "
              WHERE user_id = %d AND status = 'posted'
              ORDER BY y DESC, m DESC",
            get_current_user_id()
        ), ARRAY_A) ?: [];

        $years  = [];
        $months = [];
        foreach ($rows as $r) {
            $y = (int) $r['y'];
            if (!in_array($y, $years, true)) { $years[] = $y; }
            $months[$y][] = (int) $r['m'];
        }

        // (object) để bảng rỗng ra {} chứ không ra [] — client đọc theo khoá năm,
        // nhận mảng rỗng thì phải viết thêm nhánh xử lý riêng cho đúng một ca.
        return rest_ensure_response([
            'years'  => $years,
            'months' => (object) $months,
        ]);
    }

    public static function store(WP_REST_Request $req) {
        global $wpdb;
        $b = (array) $req->get_json_params();

        $mood = (string) ($b['mood'] ?? '');
        if (!in_array($mood, self::MOODS, true)) {
            return new WP_Error('bad_mood', 'mood không hợp lệ', ['status' => 400]);
        }
        $flag = (string) ($b['flag'] ?? 'none');
        if (!in_array($flag, self::FLAGS, true)) $flag = 'none';

        $body = trim((string) ($b['body'] ?? ''));
        if ($body === '') {
            return new WP_Error('bad_body', 'body không được rỗng', ['status' => 400]);
        }
        $vn = $b['vnindex'] ?? null;
        $vn = ($vn === null || $vn === '') ? null : number_format((float) $vn, 2, '.', '');

        // noted_at do BACKEND đóng dấu, client không gửi
        $wpdb->insert(self::table(), [
            'user_id'    => get_current_user_id(),
            'mood'       => $mood,
            'flag'       => $flag,
            'vnindex'    => $vn,
            'body'       => wp_kses_post($body),
            'noted_at'   => GDSFIN_Util::now_mysql(),
            'status'     => 'posted',
            'created_at' => GDSFIN_Util::now_mysql(),
        ]);
        return rest_ensure_response(['id' => (string) $wpdb->insert_id]);
    }

    public static function destroy(WP_REST_Request $req) {
        global $wpdb;
        $n = $wpdb->query($wpdb->prepare(
            "UPDATE " . self::table() . " SET status = 'void'
              WHERE id = %d AND user_id = %d AND status = 'posted'",
            absint($req['id']), get_current_user_id()
        ));
        if (!$n) return new WP_Error('not_found', 'Không tìm thấy ghi chép', ['status' => 404]);

        // Ghi chép void mềm (giữ vết kiểm toán) nhưng ẢNH XOÁ HẲN cả DB lẫn đĩa:
        // giữ file ảnh của một ghi chép không ai xem được nữa chỉ tổ phình đĩa, và
        // ảnh mới là thứ có nguy cơ lộ dữ liệu nhạy cảm.
        $imgs = GDSFIN_Journal_Images::delete_for_journal($id, $uid);

        return rest_ensure_response(['voided' => (int) $n, 'images_deleted' => $imgs]);
    }
}
