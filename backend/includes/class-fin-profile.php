<?php
defined('ABSPATH') || exit;

/** Thông tin cá nhân (Cài đặt). Lưu ở wp_usermeta, không cần bảng riêng. */
class GDSFIN_Profile {

    const KEYS = ['name' => 'gdsfin_name', 'broker' => 'gdsfin_broker', 'account' => 'gdsfin_account'];

    public static function register_routes() {
        register_rest_route('fin/v1', '/fin/profile', [
            [
                'methods'             => 'GET',
                'callback'            => [self::class, 'show'],
                'permission_callback' => fn() => current_user_can('fin_view'),
            ],
            [
                'methods'             => 'POST',
                'callback'            => [self::class, 'save'],
                'permission_callback' => fn() => current_user_can('fin_manage'),
            ],
        ]);
    }

    public static function show(WP_REST_Request $req) {
        $uid = get_current_user_id();
        $out = [];
        foreach (self::KEYS as $field => $meta) {
            $out[$field] = (string) get_user_meta($uid, $meta, true);
        }
        return rest_ensure_response($out);
    }

    public static function save(WP_REST_Request $req) {
        $uid = get_current_user_id();
        $b   = (array) $req->get_json_params();
        foreach (self::KEYS as $field => $meta) {
            if (array_key_exists($field, $b)) {
                update_user_meta($uid, $meta, sanitize_text_field((string) $b[$field]));
            }
        }
        return self::show($req);
    }
}
