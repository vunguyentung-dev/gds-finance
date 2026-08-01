<?php
defined('ABSPATH') || exit;

/**
 * Hợp đồng nhà cung cấp giá — docs/api-spec.md mục 8.11.
 * Đổi nhà cung cấp chỉ là viết một class mới thoả interface này.
 */
interface GDSFIN_Quote_Source {
    /** Tên ghi vào cột source, vd 'auto:xyz'. */
    public function name(): string;

    /**
     * @param string[] $syms
     * @param string   $trade_date 'Y-m-d'
     * @return array<string,string|null> sym => close (chuỗi, ĐỒNG/cp) hoặc null
     * @throws Exception khi nguồn lỗi — cron ghi log, KHÔNG ghi giá rác
     */
    public function fetch_closes(array $syms, string $trade_date): array;
}

/**
 * Nguồn mặc định: CHƯA CẤU HÌNH. Không trả giá nào.
 * Nhà cung cấp thật cắm vào bằng filter 'gdsfin_quote_source'.
 */
class GDSFIN_Quote_Source_None implements GDSFIN_Quote_Source {
    public function name(): string { return 'auto:none'; }
    public function fetch_closes(array $syms, string $trade_date): array {
        throw new Exception('Chưa cấu hình nguồn giá tự động (mục 8.12e). Dùng nhập tay để bù.');
    }
}

/**
 * Module dữ liệu thị trường: danh mục mã, giá đóng cửa theo phiên, cổ tức.
 * Đây là dữ liệu THAM CHIẾU dùng chung — không có user_id (mục 8.2).
 */
class GDSFIN_Market {

    const S = GDSFIN_Util::S;
    const CRON_HOOK = 'gdsfin_fetch_eod_quotes';

    /**
     * Giờ chạy cron nạp giá, theo giờ site. 14:50 vì phiên ATC của HOSE/HNX kết
     * thúc 14:45 nên giá đóng cửa đã chốt. Đổi được bằng filter dưới đây.
     * LƯU Ý: UPCOM giao dịch tới 15:00 — mã UPCOM lấy lúc 14:50 là giá TRONG
     * phiên, chưa phải giá đóng cửa (xem docs/api-spec.md mục 8.10b).
     */
    const CRON_TIME = '14:50';

    /* ===================== BẢNG ===================== */

    public static function create_tables() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        $p = $wpdb->prefix;

        dbDelta("CREATE TABLE {$p}fin_symbols (
            sym        VARCHAR(12)  NOT NULL,
            name       VARCHAR(150) NOT NULL,
            exchange   VARCHAR(10)  NOT NULL,
            sector     VARCHAR(80)  NULL,
            in_vn30    TINYINT(1)   NOT NULL DEFAULT 0,
            is_active  TINYINT(1)   NOT NULL DEFAULT 1,
            updated_at DATETIME     NOT NULL,
            PRIMARY KEY  (sym),
            KEY idx_exchange (exchange, is_active),
            KEY idx_sector (sector)
        ) $charset;

        CREATE TABLE {$p}fin_quote_history (
            sym        VARCHAR(12)   NOT NULL,
            trade_date DATE          NOT NULL,
            close      DECIMAL(20,4) NOT NULL,
            volume     BIGINT UNSIGNED NULL,
            source     VARCHAR(40)   NOT NULL,
            entered_by BIGINT UNSIGNED NULL,
            updated_at DATETIME      NOT NULL,
            PRIMARY KEY  (sym, trade_date),
            KEY idx_source (source)
        ) $charset;

        CREATE TABLE {$p}fin_dividends (
            id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            sym            VARCHAR(12)   NOT NULL,
            ex_date        DATE          NOT NULL,
            pay_date       DATE          NULL,
            kind           VARCHAR(10)   NOT NULL,
            cash_per_share DECIMAL(20,4) NULL,
            stock_ratio    DECIMAL(10,6) NULL,
            note           VARCHAR(255)  NULL,
            source         VARCHAR(40)   NOT NULL,
            created_at     DATETIME      NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY uq_sym_ex_kind (sym, ex_date, kind),
            KEY idx_sym_ex (sym, ex_date)
        ) $charset;");
    }

    private static function t_sym()  { global $wpdb; return $wpdb->prefix . 'fin_symbols'; }
    private static function t_hist() { global $wpdb; return $wpdb->prefix . 'fin_quote_history'; }
    private static function t_div()  { global $wpdb; return $wpdb->prefix . 'fin_dividends'; }

    /* ===================== PHIÊN GIAO DỊCH ===================== */

    /**
     * Phiên giao dịch gần nhất tính tới $from (mặc định hôm nay): lùi dần, bỏ T7/CN
     * và ngày trong fin_market_holidays. Dùng chung logic ngày lễ với T+2 (mục 2.4).
     */
    public static function last_trading_day(?string $from = null): string {
        $d = new DateTimeImmutable(($from ?: current_time('Y-m-d')) . ' 00:00:00', wp_timezone());
        $h = GDSFIN_Util::holidays();
        for ($i = 0; $i < 30; $i++) {
            $wd = (int) $d->format('N');
            if ($wd < 6 && !isset($h[$d->format('Y-m-d')])) return $d->format('Y-m-d');
            $d = $d->modify('-1 day');
        }
        return $d->format('Y-m-d');
    }

    /** Các mã user đang thực sự nắm giữ (KL ròng > 0), suy từ sổ lệnh. */
    public static function held_symbols(int $uid): array {
        global $wpdb;
        $t = $wpdb->prefix . 'fin_stock_txns';
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT sym, SUM(CASE WHEN txn_type='buy' THEN qty ELSE -qty END) AS shares
               FROM $t WHERE user_id = %d AND status = 'posted'
              GROUP BY sym HAVING shares > 0", $uid
        ), ARRAY_A) ?: [];
        $out = [];
        foreach ($rows as $r) $out[$r['sym']] = (string) $r['shares'];
        return $out;
    }

    /* ===================== ROUTES ===================== */

    public static function register_routes() {
        $view   = fn() => current_user_can('fin_view');
        $manage = fn() => current_user_can('fin_manage');

        register_rest_route('fin/v1', '/fin/symbols', [
            ['methods' => 'GET',  'callback' => [self::class, 'list_symbols'], 'permission_callback' => $view],
            ['methods' => 'POST', 'callback' => [self::class, 'upsert_symbol'], 'permission_callback' => $manage],
        ]);
        register_rest_route('fin/v1', '/fin/quotes', [
            'methods' => 'GET', 'callback' => [self::class, 'get_quotes'], 'permission_callback' => $view,
        ]);
        register_rest_route('fin/v1', '/fin/quotes/history', [
            'methods' => 'GET', 'callback' => [self::class, 'get_history'], 'permission_callback' => $view,
        ]);
        register_rest_route('fin/v1', '/fin/quotes/gaps', [
            'methods' => 'GET', 'callback' => [self::class, 'get_gaps'], 'permission_callback' => $view,
        ]);
        register_rest_route('fin/v1', '/fin/quotes/manual', [
            'methods' => 'PUT', 'callback' => [self::class, 'put_manual'], 'permission_callback' => $manage,
        ]);
        register_rest_route('fin/v1', '/fin/quotes/manual/(?P<sym>[A-Za-z0-9]+)/(?P<date>\d{4}-\d{2}-\d{2})', [
            'methods' => 'DELETE', 'callback' => [self::class, 'delete_manual'], 'permission_callback' => $manage,
        ]);
        register_rest_route('fin/v1', '/fin/quotes/fetch', [
            'methods' => 'POST', 'callback' => [self::class, 'fetch_now'], 'permission_callback' => $manage,
        ]);
        register_rest_route('fin/v1', '/fin/dividends', [
            ['methods' => 'GET',  'callback' => [self::class, 'list_dividends'], 'permission_callback' => $view],
            ['methods' => 'POST', 'callback' => [self::class, 'upsert_dividend'], 'permission_callback' => $manage],
        ]);
    }

    /* ===================== DANH MỤC MÃ ===================== */

    public static function list_symbols(WP_REST_Request $req) {
        global $wpdb;
        $sql = "SELECT sym, name, exchange, sector, in_vn30 FROM " . self::t_sym() . " WHERE is_active = 1";
        $args = [];
        if ($ex = strtoupper(sanitize_text_field((string) $req->get_param('exchange')))) {
            $sql .= " AND exchange = %s"; $args[] = $ex;
        }
        if ((int) $req->get_param('vn30') === 1) $sql .= " AND in_vn30 = 1";
        if ($q = sanitize_text_field((string) $req->get_param('q'))) {
            $sql .= " AND (sym LIKE %s OR name LIKE %s)";
            $args[] = '%' . $wpdb->esc_like($q) . '%';
            $args[] = '%' . $wpdb->esc_like($q) . '%';
        }
        $sql .= " ORDER BY sym ASC LIMIT 2000";
        $rows = $args ? $wpdb->get_results($wpdb->prepare($sql, ...$args), ARRAY_A) : $wpdb->get_results($sql, ARRAY_A);
        return rest_ensure_response(array_map(fn($r) => [
            'sym' => $r['sym'], 'name' => $r['name'], 'exchange' => $r['exchange'],
            'sector' => $r['sector'], 'in_vn30' => (bool) (int) $r['in_vn30'],
        ], $rows ?: []));
    }

    public static function upsert_symbol(WP_REST_Request $req) {
        global $wpdb;
        $b   = (array) $req->get_json_params();
        $sym = strtoupper(sanitize_text_field((string) ($b['sym'] ?? '')));
        if (!preg_match('/^[A-Z0-9]{3,12}$/', $sym)) {
            return new WP_Error('bad_sym', 'Mã CP phải 3-12 ký tự chữ/số', ['status' => 400]);
        }
        $ex = strtoupper(sanitize_text_field((string) ($b['exchange'] ?? 'HOSE')));
        if (!in_array($ex, ['HOSE', 'HNX', 'UPCOM'], true)) {
            return new WP_Error('bad_exchange', 'exchange phải là HOSE/HNX/UPCOM', ['status' => 400]);
        }
        $t = self::t_sym();
        $wpdb->query($wpdb->prepare(
            "INSERT INTO $t (sym, name, exchange, sector, in_vn30, is_active, updated_at)
             VALUES (%s, %s, %s, %s, %d, 1, %s)
             ON DUPLICATE KEY UPDATE name=VALUES(name), exchange=VALUES(exchange),
               sector=VALUES(sector), in_vn30=VALUES(in_vn30), updated_at=VALUES(updated_at)",
            $sym, sanitize_text_field((string) ($b['name'] ?? $sym)), $ex,
            isset($b['sector']) && $b['sector'] !== '' ? sanitize_text_field((string) $b['sector']) : null,
            !empty($b['in_vn30']) ? 1 : 0, current_time('mysql')
        ));
        return rest_ensure_response(['sym' => $sym]);
    }

    /* ===================== GIÁ ===================== */

    /**
     * Giá suy từ fin_quote_history: last = close của MAX(trade_date),
     * prev_close = close của phiên liền trước. Không có bảng "giá mới nhất" riêng.
     */
    public static function quotes_for(array $syms): array {
        global $wpdb;
        $t = self::t_hist();
        $out = [];
        foreach ($syms as $sym) {
            $rows = $wpdb->get_results($wpdb->prepare(
                "SELECT trade_date, close, source FROM $t WHERE sym = %s ORDER BY trade_date DESC LIMIT 2",
                $sym
            ), ARRAY_A);
            if (!$rows) { $out[$sym] = null; continue; }
            $cur  = $rows[0];
            $prev = $rows[1] ?? null;
            $change = $prev ? bcsub($cur['close'], $prev['close'], self::S) : null;
            $out[$sym] = [
                'trade_date' => $cur['trade_date'],
                'close'      => GDSFIN_Util::money_out($cur['close']),
                'prev_close' => $prev ? GDSFIN_Util::money_out($prev['close']) : null,
                'change'     => $change === null ? null : GDSFIN_Util::money_out($change),
                'change_pct' => ($prev && bccomp($prev['close'], '0', self::S) > 0)
                    ? GDSFIN_Util::pct_out(bcmul(bcdiv($change, $prev['close'], self::S), '100', self::S))
                    : null,
                'source'     => $cur['source'],
            ];
        }
        return $out;
    }

    public static function get_quotes(WP_REST_Request $req) {
        $raw  = (string) $req->get_param('syms');
        $syms = array_values(array_unique(array_filter(array_map(
            fn($s) => strtoupper(trim($s)), explode(',', $raw)
        ))));
        if (!$syms) $syms = array_keys(self::held_symbols(get_current_user_id()));

        $quotes = self::quotes_for($syms);
        $ltd    = self::last_trading_day();

        $behind = [];
        $missing = [];
        foreach ($quotes as $sym => $q) {
            if ($q === null) { $missing[] = $sym; continue; }
            if ($q['trade_date'] < $ltd) $behind[] = $sym;
        }
        $reasons = [];
        if ($missing) $reasons[] = 'chưa có giá: ' . implode(', ', $missing);
        if ($behind)  $reasons[] = 'giá cũ hơn phiên ' . $ltd . ': ' . implode(', ', $behind);

        return rest_ensure_response([
            'as_of'            => current_time('mysql'),
            'last_trading_day' => $ltd,
            'is_stale'         => (bool) ($missing || $behind),
            'stale_reason'     => $reasons ? implode(' · ', $reasons) : null,
            'quotes'           => $quotes,
        ]);
    }

    public static function get_history(WP_REST_Request $req) {
        global $wpdb;
        $sym = strtoupper(sanitize_text_field((string) $req->get_param('sym')));
        if ($sym === '') return new WP_Error('bad_sym', 'Thiếu tham số sym', ['status' => 400]);
        $from = GDSFIN_Util::is_date((string) $req->get_param('from')) ? $req->get_param('from') : '1970-01-01';
        $to   = GDSFIN_Util::is_date((string) $req->get_param('to')) ? $req->get_param('to') : current_time('Y-m-d');

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT trade_date, close, source FROM " . self::t_hist() . "
              WHERE sym = %s AND trade_date BETWEEN %s AND %s
              ORDER BY trade_date ASC LIMIT 3000", $sym, $from, $to
        ), ARRAY_A) ?: [];

        return rest_ensure_response(['sym' => $sym, 'points' => array_map(fn($r) => [
            'trade_date' => $r['trade_date'],
            'close'      => GDSFIN_Util::money_out($r['close']),
            'source'     => $r['source'],
        ], $rows)]);
    }

    /** Mã đang nắm mà THIẾU giá của phiên gần nhất — điều khiển UI nhập tay bù. */
    public static function get_gaps(WP_REST_Request $req) {
        global $wpdb;
        $uid  = get_current_user_id();
        $held = self::held_symbols($uid);
        $ltd  = self::last_trading_day();
        $t    = self::t_hist();
        $missing = [];

        foreach ($held as $sym => $qty) {
            $has = (int) $wpdb->get_var($wpdb->prepare(
                "SELECT COUNT(*) FROM $t WHERE sym = %s AND trade_date = %s", $sym, $ltd
            ));
            if ($has) continue;
            $last = $wpdb->get_row($wpdb->prepare(
                "SELECT trade_date, close FROM $t WHERE sym = %s ORDER BY trade_date DESC LIMIT 1", $sym
            ), ARRAY_A);
            $missing[] = [
                'sym' => $sym,
                'qty' => GDSFIN_Util::qty_out($qty),
                'last_known' => $last ? [
                    'trade_date' => $last['trade_date'],
                    'close'      => GDSFIN_Util::money_out($last['close']),
                ] : null,
            ];
        }
        return rest_ensure_response(['last_trading_day' => $ltd, 'missing' => $missing]);
    }

    public static function put_manual(WP_REST_Request $req) {
        global $wpdb;
        $b    = (array) $req->get_json_params();
        $list = isset($b['quotes']) && is_array($b['quotes']) ? $b['quotes'] : [];
        if (!$list) return new WP_Error('empty', 'Cần ít nhất một dòng trong "quotes"', ['status' => 400]);

        $today = current_time('Y-m-d');
        $h     = GDSFIN_Util::holidays();
        $t     = self::t_hist();
        $n = 0; $warnings = [];

        foreach ($list as $row) {
            $sym  = strtoupper(sanitize_text_field((string) ($row['sym'] ?? '')));
            $date = sanitize_text_field((string) ($row['trade_date'] ?? ''));
            $close = (string) ($row['close'] ?? '');

            if (!preg_match('/^[A-Z0-9]{3,12}$/', $sym)) {
                return new WP_Error('bad_sym', "Mã không hợp lệ: $sym", ['status' => 400]);
            }
            if (!GDSFIN_Util::is_date($date)) {
                return new WP_Error('bad_date', "trade_date không hợp lệ: $date", ['status' => 400]);
            }
            if ($date > $today) {
                return new WP_Error('future_date', "Không nhận giá của ngày tương lai: $date", ['status' => 400]);
            }
            if (!is_numeric($close) || bccomp($close, '0', self::S) <= 0) {
                return new WP_Error('bad_close', "close phải > 0 (mã $sym)", ['status' => 400]);
            }
            // Ngày không phải phiên: CHO ghi nhưng cảnh báo (nhất quán với 7.9c)
            $d  = new DateTimeImmutable($date . ' 00:00:00', wp_timezone());
            $wd = (int) $d->format('N');
            if ($wd >= 6 || isset($h[$date])) {
                $warnings[] = "$sym $date không phải phiên giao dịch";
            }

            $wpdb->query($wpdb->prepare(
                "INSERT INTO $t (sym, trade_date, close, volume, source, entered_by, updated_at)
                 VALUES (%s, %s, %s, NULL, 'manual', %d, %s)
                 ON DUPLICATE KEY UPDATE close=VALUES(close), source='manual',
                   entered_by=VALUES(entered_by), updated_at=VALUES(updated_at)",
                $sym, $date, bcadd($close, '0', 4), get_current_user_id(), current_time('mysql')
            ));
            $n++;
        }
        return rest_ensure_response(['upserted' => $n, 'warnings' => $warnings]);
    }

    /**
     * Xoá cứng dòng giá nhập tay để cron lấy lại. Đây là dữ liệu THAM CHIẾU, không
     * phải sổ nghiệp vụ của người dùng, nên không cần vết kiểm toán (mục 8.11).
     */
    public static function delete_manual(WP_REST_Request $req) {
        global $wpdb;
        $sym  = strtoupper((string) $req['sym']);
        $date = (string) $req['date'];
        $n = $wpdb->query($wpdb->prepare(
            "DELETE FROM " . self::t_hist() . " WHERE sym = %s AND trade_date = %s AND source = 'manual'",
            $sym, $date
        ));
        if (!$n) return new WP_Error('not_found', 'Không tìm thấy giá nhập tay cho mã/ngày này', ['status' => 404]);
        return rest_ensure_response(['deleted' => (int) $n]);
    }

    /* ===================== NẠP GIÁ TỰ ĐỘNG ===================== */

    private static function source(): GDSFIN_Quote_Source {
        /** Nhà cung cấp thật cắm vào bằng filter này. */
        $src = apply_filters('gdsfin_quote_source', new GDSFIN_Quote_Source_None());
        return $src instanceof GDSFIN_Quote_Source ? $src : new GDSFIN_Quote_Source_None();
    }

    /**
     * Nạp giá đóng cửa. LUẬT CỐT LÕI (mục 8.11): không ghi đè dòng source='manual'.
     * Nguồn lỗi thì ghi log và bỏ qua, KHÔNG ghi giá rác.
     */
    public static function fetch_eod(?string $trade_date = null, array $syms = []): array {
        global $wpdb;
        $date = $trade_date && GDSFIN_Util::is_date($trade_date) ? $trade_date : self::last_trading_day();

        if (!$syms) {
            $t = $wpdb->prefix . 'fin_stock_txns';
            $syms = $wpdb->get_col(
                "SELECT DISTINCT sym FROM $t WHERE status = 'posted'"
            ) ?: [];
        }
        if (!$syms) return ['trade_date' => $date, 'updated' => 0, 'skipped_manual' => 0, 'failed' => [], 'error' => null];

        $src = self::source();
        try {
            $closes = $src->fetch_closes($syms, $date);
        } catch (Throwable $e) {
            error_log('[gdsfin] nạp giá thất bại: ' . $e->getMessage());
            return [
                'trade_date' => $date, 'updated' => 0, 'skipped_manual' => 0,
                'failed' => $syms, 'error' => $e->getMessage(),
            ];
        }

        $t = self::t_hist();
        $updated = 0; $skipped = 0; $failed = [];
        foreach ($syms as $sym) {
            $close = $closes[$sym] ?? null;
            if ($close === null || !is_numeric($close) || bccomp((string) $close, '0', self::S) <= 0) {
                $failed[] = $sym;
                continue;
            }
            $existing = $wpdb->get_var($wpdb->prepare(
                "SELECT source FROM $t WHERE sym = %s AND trade_date = %s", $sym, $date
            ));
            if ($existing === 'manual') { $skipped++; continue; }

            $wpdb->query($wpdb->prepare(
                "INSERT INTO $t (sym, trade_date, close, volume, source, entered_by, updated_at)
                 VALUES (%s, %s, %s, NULL, %s, NULL, %s)
                 ON DUPLICATE KEY UPDATE close=VALUES(close), source=VALUES(source), updated_at=VALUES(updated_at)",
                $sym, $date, bcadd((string) $close, '0', 4), $src->name(), current_time('mysql')
            ));
            $updated++;
        }
        return ['trade_date' => $date, 'updated' => $updated, 'skipped_manual' => $skipped, 'failed' => $failed, 'error' => null];
    }

    public static function fetch_now(WP_REST_Request $req) {
        $b = (array) $req->get_json_params();
        $date = isset($b['trade_date']) ? (string) $b['trade_date'] : null;
        return rest_ensure_response(self::fetch_eod($date));
    }

    /** Đặt cron chạy sau phiên. Xem cảnh báo về WP-Cron ở mục 8.11. */
    private static function cron_time(): string {
        $t = (string) apply_filters('gdsfin_quote_cron_time', self::CRON_TIME);
        return preg_match('/^\d{2}:\d{2}$/', $t) ? $t : self::CRON_TIME;
    }

    /**
     * Đặt cron chạy sau khi ATC chốt. Nếu lịch đang đăng ký lệch giờ cấu hình thì
     * ĐẶT LẠI — nếu chỉ `return` khi đã có lịch thì đổi CRON_TIME sẽ không có tác
     * dụng và cron cứ nổ theo giờ cũ mãi.
     */
    public static function schedule_cron() {
        $tz   = wp_timezone();
        $time = self::cron_time();
        $existing = wp_next_scheduled(self::CRON_HOOK);

        if ($existing) {
            $cur = (new DateTimeImmutable('@' . $existing))->setTimezone($tz)->format('H:i');
            if ($cur === $time) return;              // đã đúng giờ, không làm gì
            wp_unschedule_event($existing, self::CRON_HOOK);
        }

        $next = new DateTimeImmutable("today $time", $tz);
        if ($next->getTimestamp() <= time()) $next = $next->modify('+1 day');
        wp_schedule_event($next->getTimestamp(), 'daily', self::CRON_HOOK);
    }

    public static function unschedule_cron() {
        $ts = wp_next_scheduled(self::CRON_HOOK);
        if ($ts) wp_unschedule_event($ts, self::CRON_HOOK);
    }

    public static function run_cron() {
        $ltd = self::last_trading_day();
        // Không chạy nếu hôm nay không phải phiên
        if ($ltd !== current_time('Y-m-d')) return;
        self::fetch_eod($ltd);
    }

    /* ===================== CỔ TỨC ===================== */

    public static function list_dividends(WP_REST_Request $req) {
        global $wpdb;
        $raw  = (string) $req->get_param('syms');
        $syms = array_values(array_filter(array_map(fn($s) => strtoupper(trim($s)), explode(',', $raw))));
        if (!$syms) $syms = array_keys(self::held_symbols(get_current_user_id()));
        if (!$syms) return rest_ensure_response([]);

        $ph  = implode(',', array_fill(0, count($syms), '%s'));
        $sql = "SELECT sym, ex_date, pay_date, kind, cash_per_share, stock_ratio, note
                  FROM " . self::t_div() . " WHERE sym IN ($ph)";
        $args = $syms;
        if ($y = absint($req->get_param('year'))) { $sql .= " AND YEAR(ex_date) = %d"; $args[] = $y; }
        $sql .= " ORDER BY ex_date DESC LIMIT 500";

        $rows = $wpdb->get_results($wpdb->prepare($sql, ...$args), ARRAY_A) ?: [];
        return rest_ensure_response($rows);
    }

    public static function upsert_dividend(WP_REST_Request $req) {
        global $wpdb;
        $b   = (array) $req->get_json_params();
        $sym = strtoupper(sanitize_text_field((string) ($b['sym'] ?? '')));
        if (!preg_match('/^[A-Z0-9]{3,12}$/', $sym)) {
            return new WP_Error('bad_sym', 'Mã CP không hợp lệ', ['status' => 400]);
        }
        $ex = sanitize_text_field((string) ($b['ex_date'] ?? ''));
        if (!GDSFIN_Util::is_date($ex)) {
            return new WP_Error('bad_date', 'ex_date phải dạng Y-m-d', ['status' => 400]);
        }
        $kind = ($b['kind'] ?? '') === 'stock' ? 'stock' : 'cash';
        if ($kind === 'cash' && (!isset($b['cash_per_share']) || bccomp((string) $b['cash_per_share'], '0', self::S) <= 0)) {
            return new WP_Error('bad_value', 'cash_per_share phải > 0 khi kind=cash', ['status' => 400]);
        }
        $pay = isset($b['pay_date']) && GDSFIN_Util::is_date((string) $b['pay_date']) ? $b['pay_date'] : null;

        $t = self::t_div();
        $wpdb->query($wpdb->prepare(
            "INSERT INTO $t (sym, ex_date, pay_date, kind, cash_per_share, stock_ratio, note, source, created_at)
             VALUES (%s, %s, %s, %s, %s, %s, %s, 'manual', %s)
             ON DUPLICATE KEY UPDATE pay_date=VALUES(pay_date), cash_per_share=VALUES(cash_per_share),
               stock_ratio=VALUES(stock_ratio), note=VALUES(note)",
            $sym, $ex, $pay, $kind,
            $kind === 'cash' ? bcadd((string) $b['cash_per_share'], '0', 4) : null,
            $kind === 'stock' && isset($b['stock_ratio']) ? (string) $b['stock_ratio'] : null,
            sanitize_text_field((string) ($b['note'] ?? '')), current_time('mysql')
        ));
        return rest_ensure_response(['sym' => $sym, 'ex_date' => $ex, 'kind' => $kind]);
    }

    /** Tổng cổ tức tiền/cp công bố trong năm, theo mã. */
    public static function cash_dividend_per_share(array $syms, int $year): array {
        global $wpdb;
        if (!$syms) return [];
        $ph = implode(',', array_fill(0, count($syms), '%s'));
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT sym, SUM(cash_per_share) AS total FROM " . self::t_div() . "
              WHERE kind = 'cash' AND YEAR(ex_date) = %d AND sym IN ($ph) GROUP BY sym",
            array_merge([$year], $syms)
        ), ARRAY_A) ?: [];
        $out = [];
        foreach ($rows as $r) $out[$r['sym']] = (string) $r['total'];
        return $out;
    }

    /** Ngành theo mã; mã không có trong fin_symbols -> null (gọi bên ngoài gom "Chưa phân loại"). */
    public static function sectors_of(array $syms): array {
        global $wpdb;
        if (!$syms) return [];
        $ph = implode(',', array_fill(0, count($syms), '%s'));
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT sym, name, sector FROM " . self::t_sym() . " WHERE sym IN ($ph)", ...$syms
        ), ARRAY_A) ?: [];
        $out = [];
        foreach ($rows as $r) $out[$r['sym']] = ['name' => $r['name'], 'sector' => $r['sector']];
        return $out;
    }
}
