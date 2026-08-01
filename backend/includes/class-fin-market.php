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
 * Nguồn tham chiếu để test / làm mẫu. KHÔNG được dùng làm mặc định:
 * chuỗi nguồn rỗng nghĩa là "chưa cấu hình", xem GDSFIN_Market::sources().
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
     * Giờ chạy cron nạp giá, theo giờ site (phải là giờ VN — xem GDSFIN_Util::tz()).
     * 15:05 là sau khi MỌI bảng đã đóng: HOSE/HNX chốt ATC 14:45 rồi thoả thuận tới
     * 15:00, UPCOM giao dịch tới 15:00. Nên giá 15:05 là giá đóng cửa cho cả ba.
     * Đổi được bằng filter 'gdsfin_quote_cron_time'.
     */
    const CRON_TIME = '15:05';

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
        $d = new DateTimeImmutable(($from ?: GDSFIN_Util::today()) . ' 00:00:00', GDSFIN_Util::tz());
        $h = GDSFIN_Util::holidays();
        for ($i = 0; $i < 30; $i++) {
            $wd = (int) $d->format('N');
            if ($wd < 6 && !isset($h[$d->format('Y-m-d')])) return $d->format('Y-m-d');
            $d = $d->modify('-1 day');
        }
        return $d->format('Y-m-d');
    }

    /**
     * Số PHIÊN GIAO DỊCH giữa $from (không tính) và $to (tính) — mục 9.4.
     * Đếm theo phiên chứ không theo ngày lịch: nghỉ lễ dài thì đếm ngày lịch sẽ
     * báo động sai. Dùng chung logic bỏ T7/CN + fin_market_holidays với T+2.
     */
    public static function sessions_between(string $from, string $to): int {
        if ($from >= $to) return 0;
        $h = GDSFIN_Util::holidays();
        $d = new DateTimeImmutable($from . ' 00:00:00', GDSFIN_Util::tz());
        $e = new DateTimeImmutable($to . ' 00:00:00', GDSFIN_Util::tz());
        $n = 0;
        while ($d < $e && $n < 400) {
            $d  = $d->modify('+1 day');
            $wd = (int) $d->format('N');
            if ($wd < 6 && !isset($h[$d->format('Y-m-d')])) $n++;
        }
        return $n;
    }

    /** current (0 phiên) · recent (1-2) · stale (>=3) · none (chưa có giá) — mục 9.4. */
    public static function staleness_of(?int $sessions_behind): string {
        if ($sessions_behind === null) return 'none';
        if ($sessions_behind <= 0) return 'current';
        return $sessions_behind >= 3 ? 'stale' : 'recent';
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
        register_rest_route('fin/v1', '/fin/quotes/health', [
            'methods' => 'GET', 'callback' => [self::class, 'health'], 'permission_callback' => $view,
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
            !empty($b['in_vn30']) ? 1 : 0, GDSFIN_Util::now_mysql()
        ));
        return rest_ensure_response(['sym' => $sym]);
    }

    /* ===================== GIÁ ===================== */

    /**
     * Giá suy từ fin_quote_history: last = close của MAX(trade_date),
     * prev_close = close của phiên liền trước. Không có bảng "giá mới nhất" riêng.
     */
    /**
     * Giá suy từ fin_quote_history, kèm NGUỒN GỐC theo mục 9.2.
     * Trả `close_price` (không phải `close`) — đổi tên có chủ ý để mọi nơi hiển thị
     * giá buộc phải đi qua hợp đồng có nguồn, không lấy lẻ một con số rồi giấu nguồn.
     */
    /* ===================== BIÊN ĐỘ GIÁ ===================== */

    /**
     * Biên độ dao động theo sàn. Không có sàn trong bảng này => KHÔNG đoán.
     * (ETF/CW/ngày giao dịch đầu tiên có biên khác, chưa xử lý — xem ghi chú ở price_band.)
     */
    const BANDS = ['HOSE' => '7', 'HNX' => '10', 'UPCOM' => '15'];

    /**
     * Bước giá theo sàn, tính theo GIÁ THAM CHIẾU (đồng/cp).
     * HOSE chia ba mức; HNX và UPCOM một mức 100đ.
     */
    public static function tick_size(string $exchange, string $ref): string {
        if (strtoupper($exchange) === 'HOSE') {
            if (bccomp($ref, '10000', 4) < 0) return '10';
            if (bccomp($ref, '50000', 4) < 0) return '50';
            return '100';
        }
        return '100';
    }

    /** Chia lấy phần nguyên (làm tròn xuống) cho số dương. */
    private static function div_floor(string $a, string $b): string {
        return bcdiv($a, $b, 0);
    }

    /** Chia làm tròn LÊN cho số dương. */
    private static function div_ceil(string $a, string $b): string {
        $q = bcdiv($a, $b, 0);
        return bccomp(bcmul($q, $b, self::S), $a, self::S) < 0 ? bcadd($q, '1', 0) : $q;
    }

    /**
     * Trần / Sàn của một phiên, tính từ GIÁ THAM CHIẾU của phiên đó.
     *
     * Trần = bội số bước giá LỚN NHẤT còn <= ref × (1 + biên)
     * Sàn  = bội số bước giá NHỎ NHẤT còn >= ref × (1 − biên)
     *
     * KHÔNG port được từ prototype: ceil/floor ở đó là chuỗi hardcode và tự mâu thuẫn
     * (FPT khớp làm-tròn-xuống, HPG khớp làm-tròn-gần-nhất), nên không có luật nào tái
     * tạo được cả bộ. Đây là luật thật của HOSE/HNX/UPCOM.
     *
     * CHƯA xử lý: ETF, chứng quyền, ngày giao dịch đầu tiên, ngày sau hưởng quyền —
     * các trường hợp đó có biên độ riêng. Sàn không nằm trong BANDS thì trả null chứ
     * không đoán bằng biên của HOSE.
     */
    public static function price_band(?string $exchange, ?string $ref): ?array {
        if ($ref === null || bccomp($ref, '0', 4) <= 0) return null;
        $ex = strtoupper((string) $exchange);
        if (!isset(self::BANDS[$ex])) return null;

        $band = bcdiv(self::BANDS[$ex], '100', self::S);
        $tick = self::tick_size($ex, $ref);

        $hi = bcmul($ref, bcadd('1', $band, self::S), self::S);
        $lo = bcmul($ref, bcsub('1', $band, self::S), self::S);

        $ceiling = bcmul(self::div_floor($hi, $tick), $tick, self::S);
        $floor   = bcmul(self::div_ceil($lo, $tick), $tick, self::S);

        // Biên trùng giá tham chiếu (xảy ra khi biên nhỏ hơn một bước giá) thì phải
        // lệch ra đúng một bước, nếu không thì mã đó "không được phép nhích".
        if (bccomp($ceiling, $ref, 4) <= 0) $ceiling = bcadd($ref, $tick, self::S);
        if (bccomp($floor, $ref, 4) >= 0)   $floor   = bcsub($ref, $tick, self::S);
        if (bccomp($floor, $tick, 4) < 0)   $floor   = $tick;

        return [
            'ceiling'  => GDSFIN_Util::money_out($ceiling),
            'floor'    => GDSFIN_Util::money_out($floor),
            'band_pct' => GDSFIN_Util::pct_out(self::BANDS[$ex]),
            'tick'     => GDSFIN_Util::money_out($tick),
            'exchange' => $ex,
        ];
    }

    /** Sàn của từng mã, đọc một lượt từ fin_symbols. Mã chưa khai báo -> null. */
    private static function exchanges_of(array $syms): array {
        global $wpdb;
        if (!$syms) return [];
        $ph   = implode(',', array_fill(0, count($syms), '%s'));
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT sym, exchange FROM " . self::t_sym() . " WHERE sym IN ($ph)", ...$syms
        ), ARRAY_A) ?: [];
        $out = [];
        foreach ($rows as $r) $out[$r['sym']] = $r['exchange'];
        return $out;
    }

    public static function quotes_for(array $syms, ?string $as_of_session = null): array {
        global $wpdb;
        $t   = self::t_hist();
        $ltd = $as_of_session ?: self::last_trading_day();
        $ex  = self::exchanges_of($syms);
        $out = [];
        foreach ($syms as $sym) {
            $rows = $wpdb->get_results($wpdb->prepare(
                "SELECT trade_date, close, source, updated_at FROM $t
                  WHERE sym = %s ORDER BY trade_date DESC LIMIT 2",
                $sym
            ), ARRAY_A);
            if (!$rows) { $out[$sym] = null; continue; }
            $cur  = $rows[0];
            $prev = $rows[1] ?? null;
            $change = $prev ? bcsub($cur['close'], $prev['close'], self::S) : null;
            $behind = self::sessions_between($cur['trade_date'], $ltd);
            $out[$sym] = [
                'close_price' => GDSFIN_Util::money_out($cur['close']),
                'prev_close'  => $prev ? GDSFIN_Util::money_out($prev['close']) : null,
                'change'      => $change === null ? null : GDSFIN_Util::money_out($change),
                'change_pct'  => ($prev && bccomp($prev['close'], '0', self::S) > 0)
                    ? GDSFIN_Util::pct_out(bcmul(bcdiv($change, $prev['close'], self::S), '100', self::S))
                    : null,
                // --- nguồn gốc, mục 9.2: UI không được hiện giá mà giấu mấy trường này ---
                'source'          => $cur['source'],
                'is_manual'       => $cur['source'] === 'manual',
                'fetched_at'      => $cur['updated_at'],
                'trade_date'      => $cur['trade_date'],
                'sessions_behind' => $behind,
                'staleness'       => self::staleness_of($behind),
                // Biên độ của CHÍNH phiên này => tính từ giá tham chiếu của nó, tức
                // prev_close. Không có prev_close, hoặc mã chưa khai sàn => null.
                'band'            => self::price_band($ex[$sym] ?? null, $prev ? $prev['close'] : null),
                // Biên độ cho phiên KẾ TIẾP, tính từ giá đóng cửa vừa rồi. Đây là số
                // dùng để đặt lệnh, khác 'band' ở trên — nên trả riêng, không gộp.
                'next_band'       => self::price_band($ex[$sym] ?? null, $cur['close']),
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
            if ($q['sessions_behind'] > 0) $behind[] = $sym . ' (' . $q['sessions_behind'] . ' phiên)';
        }
        $reasons = [];
        if ($missing) $reasons[] = 'chưa có giá: ' . implode(', ', $missing);
        if ($behind)  $reasons[] = 'giá cũ hơn phiên ' . $ltd . ': ' . implode(', ', $behind);

        return rest_ensure_response([
            'as_of'            => GDSFIN_Util::now_mysql(),
            'last_trading_day' => $ltd,
            'is_stale'         => (bool) ($missing || $behind),
            'stale_reason'     => $reasons ? implode(' · ', $reasons) : null,
            'quotes'           => $quotes,
        ]);
    }

    /* ===================== CHỈ BÁO KỸ THUẬT ===================== */

    /**
     * Chỉ báo tính từ CHUỖI GIÁ ĐÓNG CỬA trong fin_quote_history.
     *
     * Đính chính một nhận định sai đã ghi ở mục 11.3 lần đầu: RSI, MACD và MA đều chỉ
     * cần giá đóng cửa, KHÔNG cần khối lượng hay dữ liệu trong phiên. Chúng tính được.
     * Cái thiếu là SỐ LƯỢNG PHIÊN, không phải loại dữ liệu — nên mỗi chỉ báo trả kèm
     * available + reason nêu rõ cần bao nhiêu phiên và đang có bao nhiêu.
     *
     * Dùng bcmath scale 10 như mọi phép tính khác của dự án: MA và MACD mang đơn vị
     * đồng/cp nên không được cộng dồn bằng float.
     */
    private static function sma(array $c, int $n, int $end): ?string {
        if ($end + 1 < $n) return null;
        $s = '0';
        for ($i = $end - $n + 1; $i <= $end; $i++) $s = bcadd($s, $c[$i], self::S);
        return bcdiv($s, (string) $n, self::S);
    }

    /** EMA cả chuỗi, mồi bằng SMA tại điểm thứ n-1. Trước đó là null. */
    private static function ema_series(array $c, int $n): array {
        $out = array_fill(0, count($c), null);
        if (count($c) < $n) return $out;
        $k = bcdiv('2', (string) ($n + 1), self::S);
        $out[$n - 1] = self::sma($c, $n, $n - 1);
        for ($i = $n; $i < count($c); $i++) {
            // ema = prev + k × (giá − prev)
            $out[$i] = bcadd($out[$i - 1], bcmul($k, bcsub($c[$i], $out[$i - 1], self::S), self::S), self::S);
        }
        return $out;
    }

    private static function sma_series(array $c, int $n): array {
        $out = array_fill(0, count($c), null);
        for ($i = $n - 1; $i < count($c); $i++) $out[$i] = self::sma($c, $n, $i);
        return $out;
    }

    /** RSI Wilder: mồi bằng trung bình 14 biến động đầu, sau đó làm trơn dần. */
    private static function rsi_series(array $c, int $n = 14): array {
        $len = count($c);
        $out = array_fill(0, $len, null);
        if ($len < $n + 1) return $out;

        $g = '0'; $l = '0';
        for ($i = 1; $i <= $n; $i++) {
            $d = bcsub($c[$i], $c[$i - 1], self::S);
            if (bccomp($d, '0', self::S) >= 0) $g = bcadd($g, $d, self::S);
            else                               $l = bcadd($l, bcsub('0', $d, self::S), self::S);
        }
        $ag = bcdiv($g, (string) $n, self::S);
        $al = bcdiv($l, (string) $n, self::S);
        $out[$n] = self::rsi_of($ag, $al);

        for ($i = $n + 1; $i < $len; $i++) {
            $d  = bcsub($c[$i], $c[$i - 1], self::S);
            $up = bccomp($d, '0', self::S) >= 0 ? $d : '0';
            $dn = bccomp($d, '0', self::S) < 0 ? bcsub('0', $d, self::S) : '0';
            $ag = bcdiv(bcadd(bcmul($ag, (string) ($n - 1), self::S), $up, self::S), (string) $n, self::S);
            $al = bcdiv(bcadd(bcmul($al, (string) ($n - 1), self::S), $dn, self::S), (string) $n, self::S);
            $out[$i] = self::rsi_of($ag, $al);
        }
        return $out;
    }

    private static function rsi_of(string $ag, string $al): string {
        // Không có phiên giảm nào => RSI = 100. Chia cho 0 là ca thật, không phải lỗi.
        if (bccomp($al, '0', self::S) === 0) return bccomp($ag, '0', self::S) === 0 ? '50' : '100';
        $rs = bcdiv($ag, $al, self::S);
        return bcsub('100', bcdiv('100', bcadd('1', $rs, self::S), self::S), self::S);
    }

    /** Bọc một chỉ báo thành {series, latest, available, reason} — mẫu của mục 8.8. */
    private static function ind_out(array $series, int $need, int $have, string $what, int $scale = 4): array {
        $last = null;
        for ($i = count($series) - 1; $i >= 0; $i--) {
            if ($series[$i] !== null) { $last = $series[$i]; break; }
        }
        return [
            'series'    => array_map(
                fn($v) => $v === null ? null : ($scale === 2 ? GDSFIN_Util::pct_out($v) : GDSFIN_Util::money_out($v)),
                $series
            ),
            'latest'    => $last === null ? null
                : ($scale === 2 ? GDSFIN_Util::pct_out($last) : GDSFIN_Util::money_out($last)),
            'available' => $last !== null,
            'reason'    => $last !== null ? null
                : "$what cần $need phiên, đang có $have — nhập thêm giá để tính được",
        ];
    }

    /**
     * Toàn bộ chỉ báo cho một chuỗi đóng cửa.
     * $closes đã sắp theo trade_date tăng dần.
     */
    public static function indicators(array $closes): array {
        $have = count($closes);

        $ma20 = self::sma_series($closes, 20);
        $ma50 = self::sma_series($closes, 50);
        $rsi  = self::rsi_series($closes, 14);

        // MACD = EMA12 − EMA26; tín hiệu = EMA9 của MACD
        $e12 = self::ema_series($closes, 12);
        $e26 = self::ema_series($closes, 26);
        $line = array_fill(0, $have, null);
        for ($i = 0; $i < $have; $i++) {
            if ($e12[$i] !== null && $e26[$i] !== null) $line[$i] = bcsub($e12[$i], $e26[$i], self::S);
        }
        // EMA của MACD chỉ chạy trên phần đã có số, rồi ghép lại đúng chỉ số gốc.
        $compact = array_values(array_filter($line, fn($v) => $v !== null));
        $sig_c   = self::ema_series($compact, 9);
        $signal  = array_fill(0, $have, null);
        $offset  = $have - count($compact);
        foreach ($sig_c as $j => $v) if ($v !== null) $signal[$offset + $j] = $v;

        $hist = array_fill(0, $have, null);
        for ($i = 0; $i < $have; $i++) {
            if ($line[$i] !== null && $signal[$i] !== null) $hist[$i] = bcsub($line[$i], $signal[$i], self::S);
        }

        return [
            'sessions' => $have,
            'ma20'     => self::ind_out($ma20, 20, $have, 'MA20'),
            'ma50'     => self::ind_out($ma50, 50, $have, 'MA50'),
            'rsi14'    => self::ind_out($rsi, 15, $have, 'RSI(14)', 2),
            'macd'     => [
                'line'   => self::ind_out($line, 26, $have, 'MACD'),
                'signal' => self::ind_out($signal, 34, $have, 'Đường tín hiệu MACD'),
                'hist'   => self::ind_out($hist, 34, $have, 'Histogram MACD'),
            ],
        ];
    }

    public static function get_history(WP_REST_Request $req) {
        global $wpdb;
        $sym = strtoupper(sanitize_text_field((string) $req->get_param('sym')));
        if ($sym === '') return new WP_Error('bad_sym', 'Thiếu tham số sym', ['status' => 400]);
        $from = GDSFIN_Util::is_date((string) $req->get_param('from')) ? $req->get_param('from') : '1970-01-01';
        $to   = GDSFIN_Util::is_date((string) $req->get_param('to')) ? $req->get_param('to') : GDSFIN_Util::today();

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT trade_date, close, source, updated_at FROM " . self::t_hist() . "
              WHERE sym = %s AND trade_date BETWEEN %s AND %s
              ORDER BY trade_date ASC LIMIT 3000", $sym, $from, $to
        ), ARRAY_A) ?: [];

        $closes = array_map(fn($r) => (string) $r['close'], $rows);
        $manual = 0;
        foreach ($rows as $r) if ($r['source'] === 'manual') $manual++;

        return rest_ensure_response([
            'sym'    => $sym,
            'points' => array_map(fn($r) => [
                'trade_date'  => $r['trade_date'],
                'close_price' => GDSFIN_Util::money_out($r['close']),
                'source'      => $r['source'],
                'is_manual'   => $r['source'] === 'manual',
                'fetched_at'  => $r['updated_at'],
            ], $rows),
            // Nguồn gốc của cả chuỗi — mục 9.1 áp cho biểu đồ, không chỉ cho một giá.
            'coverage' => [
                'sessions'    => count($rows),
                'from'        => $rows ? $rows[0]['trade_date'] : null,
                'to'          => $rows ? end($rows)['trade_date'] : null,
                'manual'      => $manual,
                'auto'        => count($rows) - $manual,
            ],
            'indicators' => self::indicators($closes),
        ]);
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
                    'trade_date'  => $last['trade_date'],
                    'close_price' => GDSFIN_Util::money_out($last['close']),
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

        $today = GDSFIN_Util::today();
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
            $d  = new DateTimeImmutable($date . ' 00:00:00', GDSFIN_Util::tz());
            $wd = (int) $d->format('N');
            if ($wd >= 6 || isset($h[$date])) {
                $warnings[] = "$sym $date không phải phiên giao dịch";
            }

            $wpdb->query($wpdb->prepare(
                "INSERT INTO $t (sym, trade_date, close, volume, source, entered_by, updated_at)
                 VALUES (%s, %s, %s, NULL, 'manual', %d, %s)
                 ON DUPLICATE KEY UPDATE close=VALUES(close), source='manual',
                   entered_by=VALUES(entered_by), updated_at=VALUES(updated_at)",
                $sym, $date, bcadd($close, '0', 4), get_current_user_id(), GDSFIN_Util::now_mysql()
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

    const HEALTH_OPTION = 'gdsfin_quote_source_health';

    /**
     * CHUỖI nguồn theo thứ tự ưu tiên — mục 9.6(3).
     * Cắm nhà cung cấp bằng filter 'gdsfin_quote_sources', trả mảng các đối tượng
     * thoả GDSFIN_Quote_Source. Mảng rỗng = chưa cấu hình nguồn tự động, lúc đó chỉ
     * còn đường nhập tay.
     *
     * @return GDSFIN_Quote_Source[]
     */
    private static function sources(): array {
        $list = apply_filters('gdsfin_quote_sources', []);
        $out  = [];
        foreach ((array) $list as $src) {
            if ($src instanceof GDSFIN_Quote_Source) $out[] = $src;
        }
        return $out;
    }

    /** Ghi nhận một lần gọi nguồn để chẩn đoán khi CẢ CHUỖI cùng chết (mục 9.6). */
    private static function record_health(string $name, bool $ok, ?string $error = null) {
        $all = get_option(self::HEALTH_OPTION, []);
        if (!is_array($all)) $all = [];
        $h = $all[$name] ?? ['last_ok_at' => null, 'last_error_at' => null, 'last_error' => null, 'attempts' => []];
        $now = GDSFIN_Util::now_mysql();
        if ($ok) $h['last_ok_at'] = $now;
        else { $h['last_error_at'] = $now; $h['last_error'] = $error; }

        // giữ 7 ngày để tính ok_rate_7d
        $h['attempts'][] = ['at' => $now, 'ok' => $ok];
        $cut = GDSFIN_Util::now()->modify('-7 day')->format('Y-m-d H:i:s');
        $h['attempts'] = array_values(array_filter($h['attempts'], fn($a) => $a['at'] >= $cut));

        $all[$name] = $h;
        update_option(self::HEALTH_OPTION, $all, false);
    }

    public static function health(WP_REST_Request $req) {
        $all = get_option(self::HEALTH_OPTION, []);
        if (!is_array($all)) $all = [];
        $names = array_map(fn($s) => $s->name(), self::sources());
        foreach ($names as $n) if (!isset($all[$n])) $all[$n] = ['last_ok_at' => null, 'last_error_at' => null, 'last_error' => null, 'attempts' => []];

        $out = [];
        foreach ($all as $name => $h) {
            $tries = $h['attempts'] ?? [];
            $ok    = count(array_filter($tries, fn($a) => !empty($a['ok'])));
            $out[] = [
                'source'        => $name,
                'configured'    => in_array($name, $names, true),
                'last_ok_at'    => $h['last_ok_at'] ?? null,
                'last_error_at' => $h['last_error_at'] ?? null,
                'last_error'    => $h['last_error'] ?? null,
                'attempts_7d'   => count($tries),
                'ok_rate_7d'    => count($tries) ? GDSFIN_Util::pct_out(bcmul(bcdiv((string) $ok, (string) count($tries), self::S), '100', self::S)) : null,
            ];
        }
        return rest_ensure_response([
            'sources_configured' => count($names),
            'order'              => $names,
            'health'             => $out,
        ]);
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

        $sources = self::sources();
        if (!$sources) {
            $msg = 'Chưa cấu hình nguồn giá tự động (filter gdsfin_quote_sources rỗng). Dùng nhập tay để bù.';
            error_log('[gdsfin] ' . $msg);
            return [
                'trade_date' => $date, 'updated' => 0, 'skipped_manual' => 0,
                'failed' => $syms, 'error' => $msg, 'tried' => [],
            ];
        }

        // Duyệt chuỗi theo thứ tự ưu tiên; nguồn ĐẦU TIÊN trả giá hợp lệ thì thắng.
        $won   = [];   // sym => ['close'=>..., 'source'=>...]
        $tried = [];
        foreach ($sources as $src) {
            $name = $src->name();
            $need = array_values(array_diff($syms, array_keys($won)));
            if (!$need) break;
            try {
                $got = $src->fetch_closes($need, $date);
                self::record_health($name, true);
                $tried[] = ['source' => $name, 'asked' => count($need), 'ok' => true, 'error' => null];
            } catch (Throwable $e) {
                error_log("[gdsfin] nguồn $name lỗi: " . $e->getMessage());
                self::record_health($name, false, $e->getMessage());
                $tried[] = ['source' => $name, 'asked' => count($need), 'ok' => false, 'error' => $e->getMessage()];
                continue;                       // thử nguồn kế tiếp
            }
            foreach ($need as $sym) {
                $c = $got[$sym] ?? null;
                if ($c === null || !is_numeric($c) || bccomp((string) $c, '0', self::S) <= 0) continue;
                $won[$sym] = ['close' => (string) $c, 'source' => $name];
            }
        }

        $t = self::t_hist();
        $updated = 0; $skipped = 0; $failed = [];
        foreach ($syms as $sym) {
            if (!isset($won[$sym])) { $failed[] = $sym; continue; }

            // LUẬT CỐT LÕI: không ghi đè dòng nhập tay (mục 8.11)
            $existing = $wpdb->get_var($wpdb->prepare(
                "SELECT source FROM $t WHERE sym = %s AND trade_date = %s", $sym, $date
            ));
            if ($existing === 'manual') { $skipped++; continue; }

            $wpdb->query($wpdb->prepare(
                "INSERT INTO $t (sym, trade_date, close, volume, source, entered_by, updated_at)
                 VALUES (%s, %s, %s, NULL, %s, NULL, %s)
                 ON DUPLICATE KEY UPDATE close=VALUES(close), source=VALUES(source), updated_at=VALUES(updated_at)",
                $sym, $date, bcadd($won[$sym]['close'], '0', 4), $won[$sym]['source'], GDSFIN_Util::now_mysql()
            ));
            $updated++;
        }
        $all_dead = $tried && !array_filter($tried, fn($x) => $x['ok']);
        return [
            'trade_date' => $date, 'updated' => $updated, 'skipped_manual' => $skipped,
            'failed' => $failed, 'error' => $all_dead ? 'Toàn bộ nguồn trong chuỗi đều lỗi' : null,
            'tried' => $tried,
        ];
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
        $tz   = GDSFIN_Util::tz();
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
        if ($ltd !== GDSFIN_Util::today()) return;
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
            sanitize_text_field((string) ($b['note'] ?? '')), GDSFIN_Util::now_mysql()
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
