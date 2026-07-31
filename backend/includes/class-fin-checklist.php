<?php
defined('ABSPATH') || exit;

/**
 * Module Checklist mua/bán. Xem docs/api-spec.md mục 5.
 *
 * BẢO MẬT: fin_checklist_rows KHÔNG có user_id — quyền sở hữu thuộc bảng cha
 * fin_checklist_runs. Mọi endpoint đụng tới rows PHẢI verify run_id thuộc user
 * hiện tại, nếu không là lỗ IDOR (mục 0.2). Không thuộc -> trả 404, KHÔNG 403.
 */
class GDSFIN_Checklist {

    const RECS     = ['buy', 'sell', 'watch'];
    const STATUSES = ['ok', 'no', 'na', ''];   // gốc dòng 1299-1300, '' = chưa chọn (dòng 1284)

    public static function create_tables() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        $p = $wpdb->prefix;

        dbDelta("CREATE TABLE {$p}fin_checklist_runs (
            id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id    BIGINT UNSIGNED NOT NULL,
            sym        VARCHAR(12)     NOT NULL,
            rec        VARCHAR(10)     NOT NULL DEFAULT 'watch',
            buy_price  DECIMAL(20,4)   NULL,
            sell_price DECIMAL(20,4)   NULL,
            sell_date  DATE            NULL,
            vnindex    DECIMAL(10,2)   NULL,
            done_at    DATETIME        NULL,
            status     VARCHAR(15)     NOT NULL DEFAULT 'posted',
            created_at DATETIME        NOT NULL,
            PRIMARY KEY  (id),
            KEY idx_user_sym (user_id, sym, created_at)
        ) $charset;

        CREATE TABLE {$p}fin_checklist_rows (
            id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            run_id     BIGINT UNSIGNED NOT NULL,
            row_key    VARCHAR(80)     NOT NULL,
            row_status VARCHAR(4)      NOT NULL DEFAULT '',
            val        TEXT            NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY uq_run_key (run_id, row_key),
            KEY idx_run (run_id)
        ) $charset;");
    }

    private static function t_run()  { global $wpdb; return $wpdb->prefix . 'fin_checklist_runs'; }
    private static function t_row()  { global $wpdb; return $wpdb->prefix . 'fin_checklist_rows'; }

    public static function register_routes() {
        $view   = fn() => current_user_can('fin_view');
        $manage = fn() => current_user_can('fin_manage');

        register_rest_route('fin/v1', '/fin/checklist/runs', [
            ['methods' => 'GET',  'callback' => [self::class, 'index'], 'permission_callback' => $view],
            ['methods' => 'POST', 'callback' => [self::class, 'store'], 'permission_callback' => $manage],
        ]);
        register_rest_route('fin/v1', '/fin/checklist/runs/(?P<id>\d+)', [
            ['methods' => 'GET', 'callback' => [self::class, 'show'],   'permission_callback' => $view],
            ['methods' => 'PUT', 'callback' => [self::class, 'update'], 'permission_callback' => $manage],
        ]);
        register_rest_route('fin/v1', '/fin/checklist/runs/(?P<id>\d+)/rows', [
            'methods' => 'PUT', 'callback' => [self::class, 'put_rows'], 'permission_callback' => $manage,
        ]);
        register_rest_route('fin/v1', '/fin/checklist/runs/(?P<id>\d+)/complete', [
            'methods' => 'POST', 'callback' => [self::class, 'complete'], 'permission_callback' => $manage,
        ]);
    }

    /**
     * Chặn IDOR: xác nhận run_id thuộc user hiện tại.
     * Trả 404 (không phải 403) để không xác nhận "id tồn tại nhưng của người khác".
     */
    private static function own_run(int $id): ?int {
        global $wpdb;
        $found = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM " . self::t_run() . "
              WHERE id = %d AND user_id = %d AND status = 'posted'",
            $id, get_current_user_id()
        ));
        return $found ?: null;
    }

    private static function not_found() {
        return new WP_Error('not_found', 'Không tìm thấy phiên đánh giá', ['status' => 404]);
    }

    public static function index(WP_REST_Request $req) {
        global $wpdb;
        $uid  = get_current_user_id();
        $sql  = "SELECT id, sym, rec, done_at, created_at FROM " . self::t_run() . "
                  WHERE user_id = %d AND status = 'posted'";
        $args = [$uid];
        $sym  = strtoupper(sanitize_text_field((string) $req->get_param('sym')));
        if ($sym !== '') { $sql .= " AND sym = %s"; $args[] = $sym; }
        $sql .= " ORDER BY created_at DESC, id DESC LIMIT 500";

        $rows = $wpdb->get_results($wpdb->prepare($sql, ...$args), ARRAY_A) ?: [];
        return rest_ensure_response(array_map(fn($r) => [
            'id'         => (string) $r['id'],
            'sym'        => $r['sym'],
            'rec'        => $r['rec'],
            'done_at'    => $r['done_at'],
            'created_at' => $r['created_at'],
        ], $rows));
    }

    public static function store(WP_REST_Request $req) {
        global $wpdb;
        $b   = (array) $req->get_json_params();
        $sym = strtoupper(sanitize_text_field((string) ($b['sym'] ?? '')));
        if (!preg_match('/^[A-Z0-9]{3,12}$/', $sym)) {
            return new WP_Error('bad_sym', 'Mã CP phải 3-12 ký tự chữ/số', ['status' => 400]);
        }
        $wpdb->insert(self::t_run(), [
            'user_id'    => get_current_user_id(),
            'sym'        => $sym,
            'rec'        => in_array($b['rec'] ?? '', self::RECS, true) ? $b['rec'] : 'watch',
            'status'     => 'posted',
            'created_at' => current_time('mysql'),
        ]);
        return rest_ensure_response(['id' => (string) $wpdb->insert_id]);
    }

    public static function show(WP_REST_Request $req) {
        global $wpdb;
        $id = absint($req['id']);
        if (!self::own_run($id)) return self::not_found();          // IDOR guard

        $run = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . self::t_run() . " WHERE id = %d", $id
        ), ARRAY_A);

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT row_key, row_status, val FROM " . self::t_row() . " WHERE run_id = %d", $id
        ), ARRAY_A) ?: [];

        $done = 0;
        foreach ($rows as $r) if ($r['row_status'] === 'ok') $done++;   // gốc dòng 1292

        return rest_ensure_response([
            'id'         => (string) $run['id'],
            'sym'        => $run['sym'],
            'rec'        => $run['rec'],
            'buy_price'  => $run['buy_price'],
            'sell_price' => $run['sell_price'],
            'sell_date'  => $run['sell_date'],
            'vnindex'    => $run['vnindex'],
            'done_at'    => $run['done_at'],
            'created_at' => $run['created_at'],
            'rows'       => $rows,
            'progress'   => ['done' => $done, 'total' => count($rows)],
        ]);
    }

    public static function update(WP_REST_Request $req) {
        global $wpdb;
        $id = absint($req['id']);
        if (!self::own_run($id)) return self::not_found();          // IDOR guard

        $b    = (array) $req->get_json_params();
        $data = [];
        if (isset($b['rec']) && in_array($b['rec'], self::RECS, true)) $data['rec'] = $b['rec'];
        foreach (['buy_price', 'sell_price'] as $k) {
            if (array_key_exists($k, $b)) {
                $data[$k] = ($b[$k] === null || $b[$k] === '') ? null : number_format((float) $b[$k], 4, '.', '');
            }
        }
        if (array_key_exists('sell_date', $b)) {
            $v = (string) $b['sell_date'];
            $data['sell_date'] = ($v !== '' && GDSFIN_Util::is_date($v)) ? $v : null;
        }
        if (array_key_exists('vnindex', $b)) {
            $data['vnindex'] = ($b['vnindex'] === null || $b['vnindex'] === '')
                ? null : number_format((float) $b['vnindex'], 2, '.', '');
        }
        if (!$data) return rest_ensure_response(['updated' => 0]);

        // ràng buộc user_id ngay trong câu lệnh, không chỉ tin vào kiểm tra phía trên
        $wpdb->update(self::t_run(), $data, ['id' => $id, 'user_id' => get_current_user_id()]);
        return rest_ensure_response(['updated' => 1]);
    }

    public static function put_rows(WP_REST_Request $req) {
        global $wpdb;
        $id = absint($req['id']);
        if (!self::own_run($id)) return self::not_found();          // IDOR guard

        $b    = (array) $req->get_json_params();
        $rows = isset($b['rows']) && is_array($b['rows']) ? $b['rows'] : [];
        $n    = 0;
        $t    = self::t_row();

        foreach ($rows as $r) {
            $key = sanitize_text_field((string) ($r['row_key'] ?? ''));
            if ($key === '') continue;
            $st = (string) ($r['row_status'] ?? '');
            if (!in_array($st, self::STATUSES, true)) $st = '';
            $val = isset($r['val']) ? sanitize_textarea_field((string) $r['val']) : null;

            $wpdb->query($wpdb->prepare(
                "INSERT INTO $t (run_id, row_key, row_status, val) VALUES (%d, %s, %s, %s)
                 ON DUPLICATE KEY UPDATE row_status = VALUES(row_status), val = VALUES(val)",
                $id, $key, $st, $val
            ));
            $n++;
        }
        return rest_ensure_response(['updated' => $n]);
    }

    public static function complete(WP_REST_Request $req) {
        global $wpdb;
        $id = absint($req['id']);
        if (!self::own_run($id)) return self::not_found();          // IDOR guard

        $now = current_time('mysql');
        $wpdb->update(self::t_run(), ['done_at' => $now], ['id' => $id, 'user_id' => get_current_user_id()]);
        return rest_ensure_response(['done_at' => $now]);
    }
}
