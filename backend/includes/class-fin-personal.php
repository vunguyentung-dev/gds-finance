<?php
defined('ABSPATH') || exit;

/**
 * Module Tài chính cá nhân (thu/chi).
 * Đơn vị: amount lưu theo ĐỒNG (vd 45000000 = 45 triệu).
 * Danh mục lưu bằng tên (cat) để khớp thiết kế gốc, không cần bảng join.
 */
class GDSFIN_Personal {

    const CATS = [
        'in'  => ['Lương', 'Thưởng', 'Cổ tức', 'Kinh doanh', 'Khác'],
        'out' => ['Mua sắm', 'Đồ dùng thiết yếu', 'Đầu tư', 'Ăn uống', 'Di chuyển', 'Hóa đơn', 'Khác'],
    ];

    public static function register_routes() {
        $can_view   = fn() => current_user_can('fin_view');
        $can_manage = fn() => current_user_can('fin_manage');

        register_rest_route('fin/v1', '/fin/categories', [
            'methods'             => 'GET',
            'callback'            => fn() => rest_ensure_response(self::CATS),
            'permission_callback' => $can_view,
        ]);

        register_rest_route('fin/v1', '/fin/entries', [
            [
                'methods'             => 'GET',
                'callback'            => [self::class, 'list_entries'],
                'permission_callback' => $can_view,
            ],
            [
                'methods'             => 'POST',
                'callback'            => [self::class, 'create_entry'],
                'permission_callback' => $can_manage,
            ],
        ]);

        register_rest_route('fin/v1', '/fin/entries/(?P<id>\d+)', [
            'methods'             => 'DELETE',
            'callback'            => [self::class, 'delete_entry'],
            'permission_callback' => $can_manage,
        ]);

        // Endpoint tổng hợp cho biểu đồ + thẻ thống kê (tính ở backend)
        register_rest_route('fin/v1', '/fin/summary', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'summary'],
            'permission_callback' => $can_view,
        ]);
    }

    private static function table() {
        global $wpdb;
        return $wpdb->prefix . 'fin_personal';
    }

    /** Tạo bảng riêng cho thu/chi cá nhân (tách khỏi fin_transactions của cổ phiếu) */
    public static function create_table() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        $t = self::table();
        $sql = "CREATE TABLE $t (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            entry_type VARCHAR(3) NOT NULL,
            amount DECIMAL(20,4) NOT NULL,
            cat VARCHAR(100) NOT NULL,
            note VARCHAR(500) NULL,
            entry_date DATE NOT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY idx_user_date (user_id, entry_date)
        ) $charset;";
        dbDelta($sql);
    }

    public static function list_entries(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $t   = self::table();
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, entry_type, amount, cat, note, entry_date
               FROM $t WHERE user_id = %d
              ORDER BY entry_date DESC, id DESC LIMIT 2000",
            $uid
        ), ARRAY_A);
        // amount trả về dạng chuỗi để không mất chính xác
        return rest_ensure_response($rows ?: []);
    }

    public static function create_entry(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $b   = $req->get_json_params();

        $type = ($b['entry_type'] ?? '') === 'in' ? 'in' : 'out';
        $cat  = sanitize_text_field($b['cat'] ?? '');
        if (!in_array($cat, self::CATS[$type], true)) {
            return new WP_Error('bad_cat', 'Danh mục không hợp lệ', ['status' => 400]);
        }
        $amount = (float)($b['amount'] ?? 0);   // đã theo ĐỒNG
        if ($amount <= 0) {
            return new WP_Error('bad_amount', 'Số tiền phải lớn hơn 0', ['status' => 400]);
        }
        $date = sanitize_text_field($b['entry_date'] ?? GDSFIN_Util::today());

        $wpdb->insert(self::table(), [
            'user_id'    => $uid,
            'entry_type' => $type,
            'amount'     => number_format($amount, 4, '.', ''),
            'cat'        => $cat,
            'note'       => sanitize_text_field($b['note'] ?? ''),
            'entry_date' => $date,
            'created_at' => GDSFIN_Util::now_mysql(),
        ]);
        return rest_ensure_response(['id' => $wpdb->insert_id]);
    }

    public static function delete_entry(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $id  = absint($req['id']);
        // chỉ xóa bản ghi của chính mình
        $deleted = $wpdb->delete(self::table(), ['id' => $id, 'user_id' => $uid]);
        return rest_ensure_response(['deleted' => (int)$deleted]);
    }

    /** Tổng hợp thu/chi theo năm/tháng — tính ở backend, khớp logic prototype */
    public static function summary(WP_REST_Request $req) {
        global $wpdb;
        $uid  = get_current_user_id();
        $t    = self::table();
        $year = $req->get_param('year');

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT entry_type, amount, cat,
                    YEAR(entry_date) AS y, MONTH(entry_date) AS m
               FROM $t WHERE user_id = %d",
            $uid
        ), ARRAY_A);

        $years = [];
        foreach ($rows as $r) { $years[(int)$r['y']] = true; }
        krsort($years);
        $curYear = $year ? (int)$year : (array_key_first($years) ?: GDSFIN_Util::year());

        $monthly = array_fill(1, 12, ['in' => 0.0, 'out' => 0.0]);
        $catTotals = [];
        $inYear = 0.0; $outYear = 0.0;

        foreach ($rows as $r) {
            if ((int)$r['y'] !== $curYear) continue;
            $amt = (float)$r['amount']; $m = (int)$r['m'];
            if ($r['entry_type'] === 'in') {
                $monthly[$m]['in'] += $amt; $inYear += $amt;
            } else {
                $monthly[$m]['out'] += $amt; $outYear += $amt;
                $catTotals[$r['cat']] = ($catTotals[$r['cat']] ?? 0) + $amt;
            }
        }
        arsort($catTotals);

        return rest_ensure_response([
            'year'      => $curYear,
            'years'     => array_keys($years),
            'monthly'   => array_values($monthly),   // 12 phần tử [{in,out}]
            'catTotals' => $catTotals,
            'inYear'    => $inYear,
            'outYear'   => $outYear,
            'net'       => $inYear - $outYear,
        ]);
    }
}
