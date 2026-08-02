<?php
/**
 * Plugin Name: GDS Finance
 * Description: Quản lý tài chính, cổ phiếu & trading - chạy trên WordPress
 * Version: 1.1.0
 * Author: TUNGVN
 */
defined('ABSPATH') || exit;

define('GDSFIN_VERSION', '1.9.0');
define('GDSFIN_DB_VERSION', '1.8.0');
define('GDSFIN_PATH', plugin_dir_path(__FILE__));
define('GDSFIN_URL', plugin_dir_url(__FILE__));

require_once GDSFIN_PATH . 'includes/class-activator.php';
require_once GDSFIN_PATH . 'includes/class-rest.php';
// Nạp util TRƯỚC các module nghiệp vụ: mọi module đều dùng GDSFIN_Util (múi giờ,
// bcmath, định dạng), nên để nó lên đầu cho đúng thứ tự phụ thuộc.
require_once GDSFIN_PATH . 'includes/class-fin-util.php';
require_once GDSFIN_PATH . 'includes/class-fin-personal.php';
require_once GDSFIN_PATH . 'includes/class-fin-stock.php';
require_once GDSFIN_PATH . 'includes/class-fin-lots.php';
require_once GDSFIN_PATH . 'includes/class-fin-journal.php';
require_once GDSFIN_PATH . 'includes/class-fin-checklist.php';
require_once GDSFIN_PATH . 'includes/class-fin-profile.php';
require_once GDSFIN_PATH . 'includes/class-fin-market.php';
require_once GDSFIN_PATH . 'includes/class-fin-cash.php';
require_once GDSFIN_PATH . 'includes/class-fin-overview.php';
require_once GDSFIN_PATH . 'includes/class-fin-news.php';

register_activation_hook(__FILE__, ['GDSFIN_Activator', 'activate']);

add_action('plugins_loaded', function () {
    if (get_option('gdsfin_db_version') !== GDSFIN_DB_VERSION) {
        GDSFIN_Activator::activate();
        GDSFIN_Personal::create_table();
        GDSFIN_Stock::create_tables();
        GDSFIN_Lots::create_tables();
        GDSFIN_Journal::create_tables();
        GDSFIN_Checklist::create_tables();
        GDSFIN_Market::create_tables();
        GDSFIN_News::create_tables();
        GDSFIN_Market::schedule_cron();
        GDSFIN_News::schedule_cron();
        update_option('gdsfin_db_version', GDSFIN_DB_VERSION);
    }
});

add_action('rest_api_init', ['GDSFIN_Rest', 'register_routes']);
add_action('rest_api_init', ['GDSFIN_Personal', 'register_routes']);
add_action('rest_api_init', ['GDSFIN_Stock', 'register_routes']);
add_action('rest_api_init', ['GDSFIN_Lots', 'register_routes']);
add_action('rest_api_init', ['GDSFIN_Journal', 'register_routes']);
add_action('rest_api_init', ['GDSFIN_Checklist', 'register_routes']);
add_action('rest_api_init', ['GDSFIN_Profile', 'register_routes']);
add_action('rest_api_init', ['GDSFIN_Market', 'register_routes']);
add_action('rest_api_init', ['GDSFIN_Cash', 'register_routes']);
add_action('rest_api_init', ['GDSFIN_Overview', 'register_routes']);
add_action('rest_api_init', ['GDSFIN_News', 'register_routes']);

// Cron nạp giá cuối ngày — xem cảnh báo về WP-Cron ở docs/api-spec.md mục 8.11
add_action(GDSFIN_Market::CRON_HOOK, ['GDSFIN_Market', 'run_cron']);

// Tin tức: WP không có sẵn mốc 2 giờ nên phải thêm lịch TRƯỚC khi đặt sự kiện.
add_filter('cron_schedules', ['GDSFIN_News', 'add_schedule']);
add_action(GDSFIN_News::CRON_HOOK, ['GDSFIN_News', 'run_cron']);

// Tự chỉnh lịch khi giờ cấu hình đổi. Hàm này thoát sớm khi lịch đã đúng giờ nên
// không ghi gì trong trường hợp bình thường; nếu chỉ đặt lịch lúc bump DB version
// thì đổi CRON_TIME sẽ không có tác dụng.
add_action('init', ['GDSFIN_Market', 'schedule_cron']);
add_action('init', ['GDSFIN_News', 'schedule_cron']);

add_shortcode('gds_finance_app', function () {
    $dist = GDSFIN_PATH . 'assets/dist/app.js';
    if (file_exists($dist)) {
        wp_enqueue_script('gdsfin-app', GDSFIN_URL . 'assets/dist/app.js', [], GDSFIN_VERSION, true);
        wp_enqueue_style('gdsfin-app', GDSFIN_URL . 'assets/dist/app.css', [], GDSFIN_VERSION);
        wp_localize_script('gdsfin-app', 'GDSFIN', [
            'restUrl' => esc_url_raw(rest_url('fin/v1/')),
            'nonce'   => wp_create_nonce('wp_rest'),
            'user'    => wp_get_current_user()->display_name,
            // Không truyền redirect: wp_logout_url() mặc định đưa về
            // wp-login.php?loggedout=true, tức trang ĐĂNG NHẬP. Truyền home_url() thì
            // sau khi đăng xuất lại về trang chủ, không thấy form đăng nhập.
            'logoutUrl' => wp_logout_url(),
        ]);
    }
    return '<div id="gdsfin-root">Đang tải ứng dụng tài chính...</div>';
});

add_filter('theme_page_templates', function ($t) {
    $t['gdsfin-fullscreen'] = 'GDS Finance Fullscreen';
    return $t;
});

add_filter('template_include', function ($template) {
    if (is_page() && get_page_template_slug() === 'gdsfin-fullscreen') {
        if (file_exists(GDSFIN_PATH . 'assets/dist/app.js')) {
            wp_enqueue_script('gdsfin-app', GDSFIN_URL . 'assets/dist/app.js', [], GDSFIN_VERSION, true);
            wp_enqueue_style('gdsfin-app', GDSFIN_URL . 'assets/dist/app.css', [], GDSFIN_VERSION);
            wp_localize_script('gdsfin-app', 'GDSFIN', [
                'restUrl' => esc_url_raw(rest_url('fin/v1/')),
                'nonce'   => wp_create_nonce('wp_rest'),
                'user'    => wp_get_current_user()->display_name,
                // Xem ghi chú ở nhánh shortcode phía trên.
                'logoutUrl' => wp_logout_url(),
            ]);
        }
        $custom = GDSFIN_PATH . 'templates/fullscreen-app.php';
        if (file_exists($custom)) return $custom;
    }
    return $template;
});

// Rút ngắn thời gian phiên cho app tài chính
add_filter('auth_cookie_expiration', function ($length, $user_id, $remember) {
    return $remember ? 12 * HOUR_IN_SECONDS : 2 * HOUR_IN_SECONDS;
}, 10, 3);
