<?php
defined('ABSPATH') || exit;

class GDSFIN_Activator {
    public static function activate() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        $p = $wpdb->prefix;

        $sql = "CREATE TABLE {$p}fin_accounts (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            name VARCHAR(150) NOT NULL,
            acc_type VARCHAR(30) NOT NULL DEFAULT 'cash',
            currency CHAR(3) NOT NULL DEFAULT 'VND',
            opening_bal DECIMAL(20,4) NOT NULL DEFAULT 0,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY idx_user (user_id, is_active)
        ) $charset;

        CREATE TABLE {$p}fin_categories (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            parent_id BIGINT UNSIGNED NULL,
            name VARCHAR(150) NOT NULL,
            kind VARCHAR(10) NOT NULL,
            sort_order INT NOT NULL DEFAULT 0,
            PRIMARY KEY  (id),
            KEY idx_user_kind (user_id, kind)
        ) $charset;

        CREATE TABLE {$p}fin_transactions (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            account_id BIGINT UNSIGNED NOT NULL,
            category_id BIGINT UNSIGNED NULL,
            txn_date DATE NOT NULL,
            direction VARCHAR(3) NOT NULL,
            amount DECIMAL(20,4) NOT NULL,
            fee DECIMAL(20,4) NOT NULL DEFAULT 0,
            tax DECIMAL(20,4) NOT NULL DEFAULT 0,
            note VARCHAR(500) NULL,
            status VARCHAR(15) NOT NULL DEFAULT 'posted',
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY idx_user_date (user_id, txn_date),
            KEY idx_account (account_id, txn_date)
        ) $charset;";

        dbDelta($sql);
        update_option('gdsfin_db_version', GDSFIN_DB_VERSION);

        $admin = get_role('administrator');
        if ($admin) {
            $admin->add_cap('fin_manage');
            $admin->add_cap('fin_view');
        }
    }
}
