<?php
defined('ABSPATH') || exit;

/**
 * Module Tài chính cá nhân (thu/chi).
 * Đơn vị: amount lưu theo ĐỒNG (vd 45000000 = 45 triệu).
 * Danh mục lưu bằng tên (cat) để khớp thiết kế gốc, không cần bảng join.
 */
class GDSFIN_Personal {

    /**
     * Danh mục CHI không còn 'Đầu tư': nộp tiền vào TK chứng khoán giờ có loại riêng
     * (INV_CATS bên dưới) và KHÔNG phải là chi tiêu. Bỏ khỏi đây để không nhập mới
     * được nữa. Bản ghi CŨ mang cat 'Đầu tư' vẫn giữ nguyên và VẪN tính là chi —
     * summary() không đối chiếu cat với hằng số này, nên số cũ không đổi.
     */
    const CATS = [
        'in'  => ['Lương', 'Thưởng', 'Cổ tức', 'Kinh doanh', 'Khác'],
        'out' => ['Mua sắm', 'Đồ dùng thiết yếu', 'Ăn uống', 'Di chuyển', 'Hóa đơn', 'Khác'],
    ];

    /**
     * Chuyển tiền giữa hai túi của chính user — KHÔNG phải thu/chi sinh hoạt.
     * cat do backend đóng dấu, client không gửi: form chỉ có Nộp/Rút.
     */
    const INV_CATS = [
        'inv_in'  => 'Nộp vào TK chứng khoán',
        'inv_out' => 'Rút khỏi TK chứng khoán',
    ];

    const S = GDSFIN_Util::S;

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

        // Vốn ròng đã bỏ vào thị trường — CỘNG DỒN TOÀN BỘ, không lọc năm/tháng
        register_rest_route('fin/v1', '/fin/invested', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'invested'],
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
            entry_type VARCHAR(10) NOT NULL,
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

        $type = (string)($b['entry_type'] ?? '');
        if (!in_array($type, ['in', 'out', 'inv_in', 'inv_out'], true)) {
            return new WP_Error('bad_type', 'Loại khoản không hợp lệ', ['status' => 400]);
        }

        if (isset(self::INV_CATS[$type])) {
            // cat của khoản đầu tư do backend đóng, bỏ qua giá trị client gửi
            $cat = self::INV_CATS[$type];
        } else {
            $cat = sanitize_text_field($b['cat'] ?? '');
            if (!in_array($cat, self::CATS[$type], true)) {
                return new WP_Error('bad_cat', 'Danh mục không hợp lệ', ['status' => 400]);
            }
        }

        $amount = (float)($b['amount'] ?? 0);   // đã theo ĐỒNG
        if ($amount <= 0) {
            return new WP_Error('bad_amount', 'Số tiền phải lớn hơn 0', ['status' => 400]);
        }
        $amount_s = number_format($amount, 4, '.', '');

        // Vốn ròng không được âm: không rút quá số đã nộp.
        // So sánh bằng bccomp trên chuỗi, không so bằng float.
        if ($type === 'inv_out') {
            $net = self::invested_totals($uid)['net'];
            if (bccomp($amount_s, $net, 4) > 0) {
                return new WP_Error('inv_overdraw', sprintf(
                    'Không rút được %s ₫: vốn ròng hiện có %s ₫.',
                    number_format((float)$amount_s, 0, ',', '.'),
                    number_format((float)$net, 0, ',', '.')
                ), ['status' => 400, 'net' => GDSFIN_Util::money_out($net)]);
            }
        }

        $date = sanitize_text_field($b['entry_date'] ?? GDSFIN_Util::today());

        $wpdb->insert(self::table(), [
            'user_id'    => $uid,
            'entry_type' => $type,
            'amount'     => $amount_s,
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
        $t   = self::table();

        // chỉ đọc/xóa bản ghi của chính mình
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT entry_type, amount FROM $t WHERE id = %d AND user_id = %d",
            $id, $uid
        ), ARRAY_A);
        if (!$row) {
            return rest_ensure_response(['deleted' => 0]);
        }

        // Xóa một khoản NỘP có thể đẩy vốn ròng xuống âm. Chặn, giữ đúng bất biến —
        // nếu không thì cấm rút quá số nộp ở create_entry sẽ đi vòng qua đây được.
        if ($row['entry_type'] === 'inv_in') {
            $net = self::invested_totals($uid)['net'];
            if (bccomp((string)$row['amount'], $net, 4) > 0) {
                return new WP_Error('inv_underflow',
                    'Xóa khoản nộp này sẽ làm vốn ròng âm. Hãy xóa khoản rút liên quan trước.',
                    ['status' => 409]);
            }
        }

        $deleted = $wpdb->delete($t, ['id' => $id, 'user_id' => $uid]);
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
            // 'inv_in'/'inv_out' là chuyển tiền giữa hai túi của chính user.
            // KHÔNG vào Thu/Chi tháng, Thu/Chi năm, biểu đồ 12 tháng, chi tiêu theo
            // loại, dòng tiền ròng năm. Nhánh else phía dưới bắt MỌI thứ khác 'in',
            // nên thiếu dòng này thì nạp 1 tỷ sẽ hiện thành tháng chi 1 tỷ.
            if ($r['entry_type'] !== 'in' && $r['entry_type'] !== 'out') continue;
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

    /**
     * Tổng đã nộp / đã rút / vốn ròng, CỘNG DỒN TOÀN BỘ LỊCH SỬ.
     * Không lọc năm, không lọc tháng — đây là số dư luỹ kế, không phải báo cáo kỳ.
     * SUM() trên DECIMAL(20,4) trả chuỗi thập phân chính xác; trừ bằng bcsub.
     */
    public static function invested_totals(int $uid): array {
        global $wpdb;
        $t = self::table();
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT entry_type, SUM(amount) AS total
               FROM $t
              WHERE user_id = %d AND entry_type IN ('inv_in', 'inv_out')
              GROUP BY entry_type",
            $uid
        ), ARRAY_A);

        $in = '0'; $out = '0';
        foreach ($rows as $r) {
            if ($r['entry_type'] === 'inv_in')  { $in  = (string)$r['total']; }
            if ($r['entry_type'] === 'inv_out') { $out = (string)$r['total']; }
        }
        return ['in' => $in, 'out' => $out, 'net' => bcsub($in, $out, self::S)];
    }

    public static function invested(WP_REST_Request $req) {
        $t = self::invested_totals(get_current_user_id());
        return rest_ensure_response([
            'in'  => GDSFIN_Util::money_out($t['in']),
            'out' => GDSFIN_Util::money_out($t['out']),
            'net' => GDSFIN_Util::money_out($t['net']),
        ]);
    }
}
