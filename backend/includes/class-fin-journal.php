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

    public static function index(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $t   = self::table();

        $sql    = "SELECT id, mood, flag, vnindex, body, noted_at FROM $t WHERE user_id = %d AND status = 'posted'";
        $args   = [$uid];
        if ($y = absint($req->get_param('year')))  { $sql .= " AND YEAR(noted_at) = %d";  $args[] = $y; }
        if ($m = absint($req->get_param('month'))) { $sql .= " AND MONTH(noted_at) = %d"; $args[] = $m; }
        $flag = (string) $req->get_param('flag');
        if ($flag !== '' && in_array($flag, self::FLAGS, true)) { $sql .= " AND flag = %s"; $args[] = $flag; }
        $sql .= " ORDER BY noted_at DESC, id DESC LIMIT 1000";

        $rows = $wpdb->get_results($wpdb->prepare($sql, ...$args), ARRAY_A) ?: [];
        return rest_ensure_response(array_map(fn($r) => [
            'id'       => (string) $r['id'],
            'mood'     => $r['mood'],
            'flag'     => $r['flag'],
            'vnindex'  => $r['vnindex'],
            'body'     => $r['body'],
            'noted_at' => $r['noted_at'],
        ], $rows));
    }

    public static function years(WP_REST_Request $req) {
        global $wpdb;
        $rows = $wpdb->get_col($wpdb->prepare(
            "SELECT DISTINCT YEAR(noted_at) y FROM " . self::table() . "
              WHERE user_id = %d AND status = 'posted' ORDER BY y DESC",
            get_current_user_id()
        ));
        return rest_ensure_response(['years' => array_map('intval', $rows ?: [])]);
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
            'noted_at'   => current_time('mysql'),
            'status'     => 'posted',
            'created_at' => current_time('mysql'),
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
        return rest_ensure_response(['voided' => (int) $n]);
    }
}
