<?php
defined('ABSPATH') || exit;

class GDSFIN_Rest {
    public static function register_routes() {
        register_rest_route('fin/v1', '/health', [
            'methods'             => 'GET',
            'callback'            => fn() => ['status' => 'ok', 'version' => GDSFIN_VERSION],
            'permission_callback' => '__return_true',
        ]);

        register_rest_route('fin/v1', '/transactions', [
            [
                'methods'             => 'GET',
                'callback'            => [self::class, 'list_txn'],
                'permission_callback' => fn() => current_user_can('fin_view'),
            ],
            [
                'methods'             => 'POST',
                'callback'            => [self::class, 'create_txn'],
                'permission_callback' => fn() => current_user_can('fin_manage'),
            ],
        ]);
    }

    public static function list_txn(WP_REST_Request $req) {
        global $wpdb;
        $uid  = get_current_user_id();          // luôn lấy từ session
        $from = sanitize_text_field($req->get_param('from') ?: '1970-01-01');
        $to   = sanitize_text_field($req->get_param('to') ?: current_time('Y-m-d'));

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, txn_date, direction, amount, fee, note
               FROM {$wpdb->prefix}fin_transactions
              WHERE user_id = %d AND status = 'posted'
                AND txn_date BETWEEN %s AND %s
              ORDER BY txn_date DESC, id DESC LIMIT 500",
            $uid, $from, $to
        ), ARRAY_A);

        return rest_ensure_response($rows ?: []);
    }

    public static function create_txn(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $b   = $req->get_json_params();

        $wpdb->insert("{$wpdb->prefix}fin_transactions", [
            'user_id'    => $uid,
            'account_id' => absint($b['account_id'] ?? 0),
            'txn_date'   => sanitize_text_field($b['txn_date'] ?? current_time('Y-m-d')),
            'direction'  => in_array($b['direction'] ?? '', ['in','out'], true) ? $b['direction'] : 'out',
            'amount'     => number_format((float)($b['amount'] ?? 0), 4, '.', ''),
            'note'       => sanitize_text_field($b['note'] ?? ''),
            'status'     => 'posted',
            'created_at' => current_time('mysql'),
        ]);

        return rest_ensure_response(['id' => $wpdb->insert_id]);
    }
}
