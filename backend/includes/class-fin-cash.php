<?php
defined('ABSPATH') || exit;

/**
 * Tiền mặt tài khoản chứng khoán — docs/api-spec.md mục 8.5.
 *
 * DÙNG LẠI wp_fin_accounts và wp_fin_transactions đã có từ class-activator.php,
 * KHÔNG tạo bảng mới.
 *
 * Chỉ LƯU nạp/rút. Tác động của lệnh cổ phiếu TÍNH LÚC ĐỌC từ engine B
 * (total_net_buy / total_net_sell) — cùng lý do với "không lưu cost_matched"
 * ở mục 7.2: lưu thêm dòng thì void một lệnh phải void đúng dòng tiền tương ứng,
 * và sửa biểu phí sẽ làm số cũ đóng băng lệch khỏi engine A/B.
 */
class GDSFIN_Cash {

    const S = GDSFIN_Util::S;

    private static function t_acc() { global $wpdb; return $wpdb->prefix . 'fin_accounts'; }
    private static function t_txn() { global $wpdb; return $wpdb->prefix . 'fin_transactions'; }

    public static function register_routes() {
        $view   = fn() => current_user_can('fin_view');
        $manage = fn() => current_user_can('fin_manage');

        register_rest_route('fin/v1', '/fin/accounts', [
            ['methods' => 'GET',  'callback' => [self::class, 'list_accounts'],  'permission_callback' => $view],
            ['methods' => 'POST', 'callback' => [self::class, 'create_account'], 'permission_callback' => $manage],
        ]);
        register_rest_route('fin/v1', '/fin/cash-movements', [
            ['methods' => 'GET',  'callback' => [self::class, 'list_moves'],  'permission_callback' => $view],
            ['methods' => 'POST', 'callback' => [self::class, 'create_move'], 'permission_callback' => $manage],
        ]);
        register_rest_route('fin/v1', '/fin/cash-movements/(?P<id>\d+)', [
            'methods' => 'DELETE', 'callback' => [self::class, 'void_move'], 'permission_callback' => $manage,
        ]);
        register_rest_route('fin/v1', '/fin/cash-summary', [
            'methods' => 'GET', 'callback' => [self::class, 'summary_route'], 'permission_callback' => $view,
        ]);
    }

    /* ===================== TÀI KHOẢN ===================== */

    public static function list_accounts(WP_REST_Request $req) {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, name, acc_type, currency, opening_bal, is_active FROM " . self::t_acc() . "
              WHERE user_id = %d ORDER BY id ASC", get_current_user_id()
        ), ARRAY_A) ?: [];
        return rest_ensure_response(array_map(fn($r) => [
            'id' => (string) $r['id'], 'name' => $r['name'], 'acc_type' => $r['acc_type'],
            'currency' => $r['currency'],
            'opening_bal' => GDSFIN_Util::money_out($r['opening_bal']),
            'is_active' => (bool) (int) $r['is_active'],
        ], $rows));
    }

    public static function create_account(WP_REST_Request $req) {
        global $wpdb;
        $b    = (array) $req->get_json_params();
        $name = sanitize_text_field((string) ($b['name'] ?? ''));
        if ($name === '') return new WP_Error('bad_name', 'Cần tên tài khoản', ['status' => 400]);
        $open = (string) ($b['opening_bal'] ?? '0');
        if (!is_numeric($open) || bccomp($open, '0', self::S) < 0) {
            return new WP_Error('bad_opening', 'opening_bal không được âm', ['status' => 400]);
        }
        $wpdb->insert(self::t_acc(), [
            'user_id'     => get_current_user_id(),
            'name'        => $name,
            'acc_type'    => sanitize_text_field((string) ($b['acc_type'] ?? 'securities')),
            'currency'    => strtoupper(substr(sanitize_text_field((string) ($b['currency'] ?? 'VND')), 0, 3)),
            'opening_bal' => bcadd($open, '0', 4),
            'is_active'   => 1,
            'created_at'  => current_time('mysql'),
        ]);
        return rest_ensure_response(['id' => (string) $wpdb->insert_id]);
    }

    /* ===================== NẠP / RÚT ===================== */

    public static function list_moves(WP_REST_Request $req) {
        global $wpdb;
        $uid  = get_current_user_id();
        $sql  = "SELECT id, account_id, txn_date, direction, amount, note, status
                   FROM " . self::t_txn() . " WHERE user_id = %d";
        $args = [$uid];
        if ((int) $req->get_param('include_void') !== 1) $sql .= " AND status = 'posted'";
        if ($a = absint($req->get_param('account_id'))) { $sql .= " AND account_id = %d"; $args[] = $a; }
        if (GDSFIN_Util::is_date((string) $req->get_param('from'))) { $sql .= " AND txn_date >= %s"; $args[] = $req->get_param('from'); }
        if (GDSFIN_Util::is_date((string) $req->get_param('to')))   { $sql .= " AND txn_date <= %s"; $args[] = $req->get_param('to'); }
        $sql .= " ORDER BY txn_date DESC, id DESC LIMIT 1000";

        $rows = $wpdb->get_results($wpdb->prepare($sql, ...$args), ARRAY_A) ?: [];
        return rest_ensure_response(array_map(fn($r) => [
            'id' => (string) $r['id'], 'account_id' => (string) $r['account_id'],
            'txn_date' => $r['txn_date'], 'direction' => $r['direction'],
            'amount' => GDSFIN_Util::money_out($r['amount']),
            'note' => $r['note'], 'status' => $r['status'],
        ], $rows));
    }

    public static function create_move(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $b   = (array) $req->get_json_params();

        $acc = absint($b['account_id'] ?? 0);
        $own = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM " . self::t_acc() . " WHERE id = %d AND user_id = %d", $acc, $uid
        ));
        if (!$own) return new WP_Error('not_found', 'Không tìm thấy tài khoản', ['status' => 404]);

        $dir = ($b['direction'] ?? '') === 'in' ? 'in' : (($b['direction'] ?? '') === 'out' ? 'out' : '');
        if ($dir === '') return new WP_Error('bad_direction', "direction phải là 'in' hoặc 'out'", ['status' => 400]);

        $date = sanitize_text_field((string) ($b['txn_date'] ?? ''));
        if (!GDSFIN_Util::is_date($date)) return new WP_Error('bad_date', 'txn_date phải dạng Y-m-d', ['status' => 400]);

        $amt = (string) ($b['amount'] ?? '0');
        if (!is_numeric($amt) || bccomp($amt, '0', self::S) <= 0) {
            return new WP_Error('bad_amount', 'amount phải > 0', ['status' => 400]);
        }

        $wpdb->insert(self::t_txn(), [
            'user_id'    => $uid,
            'account_id' => $acc,
            'txn_date'   => $date,
            'direction'  => $dir,
            'amount'     => bcadd($amt, '0', 4),
            'note'       => sanitize_text_field((string) ($b['note'] ?? '')),
            'status'     => 'posted',
            'created_at' => current_time('mysql'),
        ]);
        return rest_ensure_response(['id' => (string) $wpdb->insert_id]);
    }

    public static function void_move(WP_REST_Request $req) {
        global $wpdb;
        $n = $wpdb->query($wpdb->prepare(
            "UPDATE " . self::t_txn() . " SET status = 'void'
              WHERE id = %d AND user_id = %d AND status = 'posted'",
            absint($req['id']), get_current_user_id()
        ));
        if (!$n) return new WP_Error('not_found', 'Không tìm thấy phát sinh tiền', ['status' => 404]);
        return rest_ensure_response(['voided' => (int) $n]);
    }

    /* ===================== SỐ DƯ ===================== */

    /**
     * balance = opening_total + deposits − withdrawals − stock_net_buy + stock_net_sell
     *
     * KHÔNG cộng fin_personal (thu/chi cá nhân) vào đây — đó là chi tiêu đời sống,
     * không phải tiền trong tài khoản chứng khoán (mục 8.5).
     */
    public static function summary(int $uid, ?array $stock_cards = null): array {
        global $wpdb;

        $opening = (string) ($wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(SUM(opening_bal),0) FROM " . self::t_acc() . "
              WHERE user_id = %d AND is_active = 1", $uid
        )) ?: '0');

        $dep = (string) ($wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(SUM(amount),0) FROM " . self::t_txn() . "
              WHERE user_id = %d AND status = 'posted' AND direction = 'in'", $uid
        )) ?: '0');

        $wdr = (string) ($wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(SUM(amount),0) FROM " . self::t_txn() . "
              WHERE user_id = %d AND status = 'posted' AND direction = 'out'", $uid
        )) ?: '0');

        // Lấy từ engine B qua fin/stock-summary — không tự tính lại
        $cards = $stock_cards ?? GDSFIN_Stock::compute($uid)['cards'];
        $buy   = (string) $cards['total_net_buy'];
        $sell  = (string) $cards['total_net_sell'];

        $bal = bcadd($opening, bcsub($dep, $wdr, self::S), self::S);
        $bal = bcadd(bcsub($bal, $buy, self::S), $sell, self::S);

        return [
            'opening_total'   => GDSFIN_Util::money_out($opening),
            'deposits'        => GDSFIN_Util::money_out($dep),
            'withdrawals'     => GDSFIN_Util::money_out($wdr),
            'stock_net_buy'   => GDSFIN_Util::money_out($buy),
            'stock_net_sell'  => GDSFIN_Util::money_out($sell),
            'balance'         => GDSFIN_Util::money_out($bal),
            'account_count'   => (int) $wpdb->get_var($wpdb->prepare(
                "SELECT COUNT(*) FROM " . self::t_acc() . " WHERE user_id = %d AND is_active = 1", $uid
            )),
            'as_of'           => current_time('mysql'),
        ];
    }

    public static function summary_route(WP_REST_Request $req) {
        return rest_ensure_response(self::summary(get_current_user_id()));
    }
}
