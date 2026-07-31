<?php
/**
 * Plugin Name: GDS Finance
 * Description: Quản lý tài chính, cổ phiếu & trading - chạy trên WordPress
 * Version: 1.1.0
 * Author: TUNGVN
 */
defined('ABSPATH') || exit;

define('GDSFIN_VERSION', '1.1.0');
define('GDSFIN_DB_VERSION', '1.1.0');
define('GDSFIN_PATH', plugin_dir_path(__FILE__));
define('GDSFIN_URL', plugin_dir_url(__FILE__));

require_once GDSFIN_PATH . 'includes/class-activator.php';
require_once GDSFIN_PATH . 'includes/class-rest.php';
require_once GDSFIN_PATH . 'includes/class-fin-personal.php';

register_activation_hook(__FILE__, ['GDSFIN_Activator', 'activate']);

add_action('plugins_loaded', function () {
    if (get_option('gdsfin_db_version') !== GDSFIN_DB_VERSION) {
        GDSFIN_Activator::activate();
        GDSFIN_Personal::create_table();
        update_option('gdsfin_db_version', GDSFIN_DB_VERSION);
    }
});

add_action('rest_api_init', ['GDSFIN_Rest', 'register_routes']);
add_action('rest_api_init', ['GDSFIN_Personal', 'register_routes']);

add_shortcode('gds_finance_app', function () {
    $dist = GDSFIN_PATH . 'assets/dist/app.js';
    if (file_exists($dist)) {
        wp_enqueue_script('gdsfin-app', GDSFIN_URL . 'assets/dist/app.js', [], GDSFIN_VERSION, true);
        wp_enqueue_style('gdsfin-app', GDSFIN_URL . 'assets/dist/app.css', [], GDSFIN_VERSION);
        wp_localize_script('gdsfin-app', 'GDSFIN', [
            'restUrl' => esc_url_raw(rest_url('fin/v1/')),
            'nonce'   => wp_create_nonce('wp_rest'),
            'user'    => wp_get_current_user()->display_name,
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
            ]);
        }
        $custom = GDSFIN_PATH . 'templates/fullscreen-app.php';
        if (file_exists($custom)) return $custom;
    }
    return $template;
});
