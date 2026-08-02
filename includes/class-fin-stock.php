<?php
defined('ABSPATH') || exit;

/**
 * Module Giao dịch cổ phiếu + biểu phí/thuế theo mốc hiệu lực.
 *
 * Cài đặt theo docs/api-spec.md. HAI ENGINE CHẠY SONG SONG, KHÔNG HỢP NHẤT:
 *   - Engine A (bình quân gia quyền) -> by_sym + cards       (gốc dòng 1113-1154)
 *   - Engine B (FIFO khớp lô đã về)  -> flow + footer        (gốc dòng 1180-1226)
 * Gốc = design-bundle/design_handoff_fin_management/VNInvest.dc.html
 *
 * Đơn vị: price theo ĐỒNG/cổ phiếu. Mọi số học bằng bcmath scale 10,
 * chỉ cắt về scale 4 ở biên JSON (mục 0.1).
 */
class GDSFIN_Stock {

    const S = GDSFIN_Util::S;

    /* ===================== BẢNG ===================== */

    public static function create_tables() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        $p = $wpdb->prefix;

        $sql = "CREATE TABLE {$p}fin_stock_txns (
            id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id     BIGINT UNSIGNED NOT NULL,
            sym         VARCHAR(12)     NOT NULL,
            txn_type    VARCHAR(4)      NOT NULL,
            txn_date    DATE            NOT NULL,
            qty         BIGINT UNSIGNED NOT NULL,
            price       DECIMAL(20,4)   NOT NULL,
            status      VARCHAR(15)     NOT NULL DEFAULT 'posted',
            voided_at   DATETIME        NULL,
            created_at  DATETIME        NOT NULL,
            PRIMARY KEY  (id),
            KEY idx_user_status_date (user_id, status, txn_date, id),
            KEY idx_user_sym (user_id, sym, txn_date)
        ) $charset;

        CREATE TABLE {$p}fin_rates (
            id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id     BIGINT UNSIGNED NOT NULL,
            eff_date    DATE            NOT NULL,
            buy_fee     DECIMAL(8,5)    NOT NULL,
            sell_fee    DECIMAL(8,5)    NOT NULL,
            tax         DECIMAL(8,5)    NOT NULL,
            created_at  DATETIME        NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY uq_user_eff (user_id, eff_date),
            KEY idx_user_eff (user_id, eff_date)
        ) $charset;

        CREATE TABLE {$p}fin_market_holidays (
            holiday_date DATE         NOT NULL,
            note         VARCHAR(150) NULL,
            PRIMARY KEY  (holiday_date)
        ) $charset;";

        dbDelta($sql);
        // fin_market_holidays CỐ Ý để rỗng: bảng rỗng => chỉ bỏ T7/CN, khớp prototype.
    }

    private static function t_txn()  { global $wpdb; return $wpdb->prefix . 'fin_stock_txns'; }
    private static function t_rate() { global $wpdb; return $wpdb->prefix . 'fin_rates'; }

    /* ===================== ROUTES ===================== */

    public static function register_routes() {
        $view   = fn() => current_user_can('fin_view');
        $manage = fn() => current_user_can('fin_manage');

        register_rest_route('fin/v1', '/fin/stock-txns', [
            ['methods' => 'GET',  'callback' => [self::class, 'list_txns'],  'permission_callback' => $view],
            ['methods' => 'POST', 'callback' => [self::class, 'create_txn'], 'permission_callback' => $manage],
        ]);

        register_rest_route('fin/v1', '/fin/stock-txns/(?P<id>\d+)', [
            'methods'             => 'DELETE',
            'callback'            => [self::class, 'void_txn'],
            'permission_callback' => $manage,
        ]);

        register_rest_route('fin/v1', '/fin/stock-summary', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'summary'],
            'permission_callback' => $view,
        ]);

        register_rest_route('fin/v1', '/fin/rates', [
            ['methods' => 'GET',  'callback' => [self::class, 'list_rates'], 'permission_callback' => $view],
            ['methods' => 'POST', 'callback' => [self::class, 'upsert_rate'], 'permission_callback' => $manage],
        ]);
    }

    /* ===================== BIỂU PHÍ ===================== */

    /**
     * Mốc phí gốc — hằng số BUY_FEE/SELL_FEE/TAX của prototype (dòng 825).
     * Chỉ dùng làm GIÁ TRỊ KHỞI TẠO cho lazy seed, không dùng để tính toán lâu dài.
     */
    const SEED_EFF_DATE = '2000-01-01';
    const SEED_BUY_FEE  = '0.15000';
    const SEED_SELL_FEE = '0.15000';
    const SEED_TAX      = '0.10000';

    /**
     * GHIM mốc phí gốc vào DB ngay khi user ghi bản ghi đầu tiên (lazy seed).
     *
     * Lý do phải ghim thành DỮ LIỆU thay vì đọc từ hằng số: nếu sau này sửa hằng
     * số trong code thì toàn bộ lãi/lỗ LỊCH SỬ sẽ được tính lại theo giá trị mới.
     * Số liệu tài chính đã chốt không được phép đổi vì một lần sửa code.
     *
     * INSERT IGNORE dựa vào UNIQUE uq_user_eff nên hai request đồng thời cùng
     * seed cũng không lỗi trùng khoá.
     */
    private static function ensure_rate_seeded(int $uid): void {
        global $wpdb;
        $t = self::t_rate();
        $has = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM $t WHERE user_id = %d", $uid
        ));
        if ($has > 0) return;

        $wpdb->query($wpdb->prepare(
            "INSERT IGNORE INTO $t (user_id, eff_date, buy_fee, sell_fee, tax, created_at)
             VALUES (%d, %s, %s, %s, %s, %s)",
            $uid, self::SEED_EFF_DATE, self::SEED_BUY_FEE, self::SEED_SELL_FEE, self::SEED_TAX,
            GDSFIN_Util::now_mysql()
        ));
    }

    /**
     * FALLBACK CHỈ khi chưa kịp seed (user có giao dịch nhưng bảng rates còn rỗng —
     * ví dụ dữ liệu chèn trực tiếp vào DB không qua API). Đường chính là mốc đã
     * ghim trong fin_rates, xem ensure_rate_seeded().
     */
    private static function default_rates(): array {
        return [[
            'id' => null, 'eff_date' => self::SEED_EFF_DATE,
            'buy_fee' => self::SEED_BUY_FEE, 'sell_fee' => self::SEED_SELL_FEE, 'tax' => self::SEED_TAX,
        ]];
    }

    private static function load_rates(int $uid): array {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, eff_date, buy_fee, sell_fee, tax FROM " . self::t_rate() . "
              WHERE user_id = %d ORDER BY eff_date ASC, id ASC", $uid
        ), ARRAY_A);
        return $rows ?: self::default_rates();
    }

    /**
     * Chọn mốc phí/thuế theo NGÀY GIAO DỊCH — gốc dòng 1110-1111.
     * Lấy mốc cuối cùng có eff_date <= d; nếu mọi mốc đều lớn hơn thì dùng mốc sớm nhất.
     */
    private static function rate_for(array $rates, string $d): array {
        $r = $rates[0];
        foreach ($rates as $x) {
            if ($x['eff_date'] <= $d) $r = $x;
        }
        return $r;
    }

    /**
     * Mốc phí đang hiệu lực tại ngày $d (mặc định hôm nay). CHỈ ĐỌC —
     * thêm cho mục 8 dùng, không thay đổi bất kỳ phép tính nào của engine A/B.
     */
    public static function rate_at(int $uid, ?string $d = null): array {
        return self::rate_for(self::load_rates($uid), $d ?: GDSFIN_Util::today());
    }

    public static function list_rates(WP_REST_Request $req) {
        $rows = self::load_rates(get_current_user_id());
        return rest_ensure_response(array_map(fn($r) => [
            'id'       => $r['id'] === null ? null : (string) $r['id'],
            'eff_date' => $r['eff_date'],
            'buy_fee'  => $r['buy_fee'],
            'sell_fee' => $r['sell_fee'],
            'tax'      => $r['tax'],
        ], $rows));
    }

    /**
     * UPSERT, không phải INSERT thuần: bảng có UNIQUE uq_user_eff (user_id, eff_date),
     * và prototype ghi đè mốc trùng ngày (applyRate dòng 1270-1274, ghi đè ở 1273).
     */
    public static function upsert_rate(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $b   = (array) $req->get_json_params();

        $eff = sanitize_text_field((string) ($b['eff_date'] ?? ''));
        if (!GDSFIN_Util::is_date($eff)) {
            return new WP_Error('bad_date', 'eff_date phải dạng Y-m-d', ['status' => 400]);
        }
        foreach (['buy_fee', 'sell_fee', 'tax'] as $k) {
            if (!isset($b[$k]) || !is_numeric($b[$k]) || (float) $b[$k] < 0) {
                return new WP_Error('bad_rate', "$k không hợp lệ", ['status' => 400]);
            }
        }

        // Ghim mốc gốc trước, để mốc mới của user không trở thành mốc sớm nhất và
        // vô tình áp cho cả các giao dịch có ngày nhỏ hơn nó (rate_for lấy rates[0]).
        self::ensure_rate_seeded($uid);

        $t      = self::t_rate();
        $exists = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM $t WHERE user_id = %d AND eff_date = %s", $uid, $eff
        ));

        $wpdb->query($wpdb->prepare(
            "INSERT INTO $t (user_id, eff_date, buy_fee, sell_fee, tax, created_at)
             VALUES (%d, %s, %s, %s, %s, %s)
             ON DUPLICATE KEY UPDATE
               buy_fee = VALUES(buy_fee), sell_fee = VALUES(sell_fee), tax = VALUES(tax)",
            $uid, $eff,
            number_format((float) $b['buy_fee'], 5, '.', ''),
            number_format((float) $b['sell_fee'], 5, '.', ''),
            number_format((float) $b['tax'], 5, '.', ''),
            GDSFIN_Util::now_mysql()
        ));

        return rest_ensure_response([
            'id'       => (string) ($exists ?: $wpdb->insert_id),
            'upserted' => $exists ? 'update' : 'insert',
        ]);
    }

    /* ===================== SỔ LỆNH ===================== */

    /** Các lệnh posted, thứ tự xử lý engine: txn_date ASC, id ASC (gốc dòng 1115-1116). */
    private static function load_txns(int $uid): array {
        global $wpdb;
        return $wpdb->get_results($wpdb->prepare(
            "SELECT id, sym, txn_type, txn_date, qty, price FROM " . self::t_txn() . "
              WHERE user_id = %d AND status = 'posted'
              ORDER BY txn_date ASC, id ASC", $uid
        ), ARRAY_A) ?: [];
    }

    public static function create_txn(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $b   = (array) $req->get_json_params();

        $sym = strtoupper(sanitize_text_field((string) ($b['sym'] ?? '')));
        if (!preg_match('/^[A-Z0-9]{3,12}$/', $sym)) {
            return new WP_Error('bad_sym', 'Mã CP phải 3-12 ký tự chữ/số', ['status' => 400]);
        }
        $type = ($b['txn_type'] ?? '') === 'buy' ? 'buy' : (($b['txn_type'] ?? '') === 'sell' ? 'sell' : '');
        if ($type === '') {
            return new WP_Error('bad_type', "txn_type phải là 'buy' hoặc 'sell'", ['status' => 400]);
        }
        $date = sanitize_text_field((string) ($b['txn_date'] ?? ''));
        if (!GDSFIN_Util::is_date($date)) {
            return new WP_Error('bad_date', 'txn_date phải dạng Y-m-d', ['status' => 400]);
        }
        $qty = (string) ($b['qty'] ?? '0');
        if (!ctype_digit($qty) || bccomp($qty, '0', 0) <= 0) {
            return new WP_Error('bad_qty', 'qty phải là số nguyên > 0', ['status' => 400]);
        }
        $price = (string) ($b['price'] ?? '0');
        if (!is_numeric($price) || bccomp($price, '0', self::S) <= 0) {
            return new WP_Error('bad_price', 'price (đồng/cp) phải > 0', ['status' => 400]);
        }

        // Ghim mốc phí gốc TRƯỚC khi có giao dịch đầu tiên, để lãi/lỗ của giao dịch
        // này về sau không bị tính lại nếu hằng số trong code thay đổi.
        self::ensure_rate_seeded($uid);

        // --- engine C: ghim lô thủ công (mục 7.5) ---
        // Kiểm TRƯỚC khi insert, để một mảng lot_matches sai không để lại lệnh rác.
        $raw_lots = $b['lot_matches'] ?? null;
        $pairs    = null;
        if ($raw_lots !== null) {
            if ($type !== 'sell') {
                return new WP_Error('bad_lots', 'lot_matches chỉ dùng cho lệnh BÁN', ['status' => 400]);
            }
            $pairs = GDSFIN_Lots::validate_manual($uid, $sym, $date, $qty, $raw_lots);
            if (is_wp_error($pairs)) return $pairs;
        }

        $wpdb->insert(self::t_txn(), [
            'user_id'    => $uid,
            'sym'        => $sym,
            'txn_type'   => $type,
            'txn_date'   => $date,
            'qty'        => $qty,
            'price'      => bcadd($price, '0', 4),
            'status'     => 'posted',
            'created_at' => GDSFIN_Util::now_mysql(),
        ]);

        $new_id = (int) $wpdb->insert_id;

        // Engine C chạy SAU khi sổ gốc đã ghi: nó là lớp dẫn xuất, không được là
        // điều kiện để lệnh vào sổ. Ghim tay trước, rồi khớp lại phần auto của mã —
        // lo luôn ca thêm lệnh LÙI NGÀY vào trước các lệnh bán đã khớp (mục 7.7).
        if ($pairs !== null) GDSFIN_Lots::write_manual($new_id, $pairs);
        GDSFIN_Lots::on_txn_created($uid, $sym, $date);

        $res = ['id' => (string) $new_id];
        if ($type === 'sell') $res['lot_matches_mode'] = $pairs === null ? 'auto' : 'manual';
        return rest_ensure_response($res);
    }

    /** Không xóa cứng — giữ vết kiểm toán. */
    public static function void_txn(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $id  = absint($req['id']);

        $txn = $wpdb->get_row($wpdb->prepare(
            "SELECT id, sym, txn_type, txn_date FROM " . self::t_txn() . "
              WHERE id = %d AND user_id = %d AND status = 'posted'", $id, $uid
        ), ARRAY_A);
        if (!$txn) {
            return new WP_Error('not_found', 'Không tìm thấy giao dịch', ['status' => 404]);
        }

        // Chặn void lệnh MUA đang bị lệnh bán khớp vào (409) — mục 7.7.
        $blocked = GDSFIN_Lots::guard_void($uid, $txn);
        if (is_wp_error($blocked)) return $blocked;

        $n = $wpdb->query($wpdb->prepare(
            "UPDATE " . self::t_txn() . "
                SET status = 'void', voided_at = %s
              WHERE id = %d AND user_id = %d AND status = 'posted'",
            GDSFIN_Util::now_mysql(), $id, $uid
        ));
        if (!$n) {
            return new WP_Error('not_found', 'Không tìm thấy giao dịch', ['status' => 404]);
        }

        GDSFIN_Lots::after_void($uid, $txn);
        return rest_ensure_response(['voided' => (int) $n]);
    }

    /** Lịch sử giao dịch, kèm giá sau phí/thuế đã tính sẵn (gốc dòng 1231). */
    public static function list_txns(WP_REST_Request $req) {
        global $wpdb;
        $uid   = get_current_user_id();
        $incl  = (int) $req->get_param('include_void') === 1;
        $where = $incl ? '' : " AND status = 'posted'";

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, sym, txn_type, txn_date, qty, price, status FROM " . self::t_txn() . "
              WHERE user_id = %d {$where}
              ORDER BY txn_date DESC, id DESC LIMIT 1000", $uid
        ), ARRAY_A) ?: [];

        $rates = self::load_rates($uid);
        $out   = [];
        foreach ($rows as $r) {
            $rt = self::rate_for($rates, $r['txn_date']);
            $bf = bcdiv($rt['buy_fee'],  '100', self::S);
            $sf = bcdiv($rt['sell_fee'], '100', self::S);
            $tx = bcdiv($rt['tax'],      '100', self::S);

            $net = $r['txn_type'] === 'buy'
                ? bcmul($r['price'], bcadd('1', $bf, self::S), self::S)
                : bcmul($r['price'], bcsub('1', bcadd($sf, $tx, self::S), self::S), self::S);

            $row = [
                'id'        => (string) $r['id'],
                'sym'       => $r['sym'],
                'txn_type'  => $r['txn_type'],
                'txn_date'  => $r['txn_date'],
                'qty'       => GDSFIN_Util::qty_out($r['qty']),
                'price'     => GDSFIN_Util::money_out($r['price']),
                'net_price' => GDSFIN_Util::money_out($net),
                'net_value' => GDSFIN_Util::money_out(bcmul($r['qty'], $net, self::S)),
            ];
            if ($incl) $row['status'] = $r['status'];
            $out[] = $row;
        }
        return rest_ensure_response($out);
    }

    /* ===================== HAI ENGINE ===================== */

    public static function summary(WP_REST_Request $req) {
        return rest_ensure_response(self::compute(get_current_user_id()));
    }

    /**
     * Chạy cả hai engine trên cùng chuỗi lệnh đã sắp thứ tự.
     * Giữ RIÊNG BIỆT, không hợp nhất: xem docs/api-spec.md mục 2.5 và footer.
     */
    public static function compute(int $uid): array {
        $txns  = self::load_txns($uid);
        $rates = self::load_rates($uid);

        // --- Engine A: bình quân gia quyền (gốc dòng 1113-1136) ---
        $acc        = [];
        $total_fees = '0';

        // --- Engine B: FIFO theo lô đã về (gốc dòng 1189-1226) ---
        $lots_by_sym = [];
        $cum_pl      = '0';
        $net_buy     = '0';
        $net_sell    = '0';
        $flow        = [];

        foreach ($txns as $t) {
            $rt = self::rate_for($rates, $t['txn_date']);
            $bf = bcdiv($rt['buy_fee'],  '100', self::S);
            $sf = bcdiv($rt['sell_fee'], '100', self::S);
            $tx = bcdiv($rt['tax'],      '100', self::S);
            $sym   = $t['sym'];
            $qty   = (string) $t['qty'];
            $price = (string) $t['price'];

            if (!isset($acc[$sym])) {
                $acc[$sym] = ['shares' => '0', 'cost' => '0', 'sold' => '0', 'realized' => '0', 'sold_base' => '0'];
            }
            $a = &$acc[$sym];
            if (!isset($lots_by_sym[$sym])) $lots_by_sym[$sym] = [];
            $lots = &$lots_by_sym[$sym];

            $settle = null; $t2_state = null; $t2_avail = null;
            $cash = '0'; $row_pl = null;

            if ($t['txn_type'] === 'buy') {
                $qp    = bcmul($qty, $price, self::S);
                $gross = bcmul($price, bcadd('1', $bf, self::S), self::S);   // giá vốn gồm phí mua

                // Engine A (dòng 1123-1125)
                $total_fees = bcadd($total_fees, bcmul($qp, $bf, self::S), self::S);
                $a['cost']   = bcadd($a['cost'], bcmul($qp, bcadd('1', $bf, self::S), self::S), self::S);
                $a['shares'] = bcadd($a['shares'], $qty, self::S);

                // Engine B (dòng 1197-1201)
                $settle   = GDSFIN_Util::add_trading_days($t['txn_date'], 2);
                $lots[]   = ['qty' => $qty, 'gross' => $gross, 'settle' => $settle];
                $spent    = bcmul($qty, $gross, self::S);
                $cash     = bcsub('0', $spent, self::S);
                $net_buy  = bcadd($net_buy, $spent, self::S);
                $t2_state = 'settled_future';

            } else {
                $rate_out = bcsub('1', bcadd($sf, $tx, self::S), self::S);    // 1 - sf - tx

                // Engine A — CHÚ Ý: phí tính trên qty CHƯA cắt (dòng 1127),
                // nhưng proceeds tính trên qty ĐÃ cắt (dòng 1129-1130). Xem mục 2.5b.
                $total_fees = bcadd(
                    $total_fees,
                    bcmul(bcmul($qty, $price, self::S), bcadd($sf, $tx, self::S), self::S),
                    self::S
                );
                $avg = bccomp($a['shares'], '0', self::S) > 0
                    ? bcdiv($a['cost'], $a['shares'], self::S)
                    : '0';
                $qc       = bccomp($qty, $a['shares'], self::S) > 0 ? $a['shares'] : $qty;  // min()
                $proceeds = bcmul(bcmul($qc, $price, self::S), $rate_out, self::S);
                $base     = bcmul($avg, $qc, self::S);

                $a['realized']  = bcadd($a['realized'], bcsub($proceeds, $base, self::S), self::S);
                $a['sold_base'] = bcadd($a['sold_base'], $base, self::S);
                $a['cost']      = bcsub($a['cost'], $base, self::S);
                $a['shares']    = bcsub($a['shares'], $qc, self::S);
                $a['sold']      = bcadd($a['sold'], $qc, self::S);

                // Engine B (dòng 1203-1212)
                $avail = '0';
                foreach ($lots as $l) {
                    if ($l['settle'] <= $t['txn_date']) $avail = bcadd($avail, $l['qty'], self::S);
                }
                $t2_avail = $avail;
                $t2_state = bccomp($qty, $avail, self::S) > 0 ? 'short' : 'ok';

                $need = $qty; $matched = '0';
                // lượt 1: CHỈ lô đã về (dòng 1207)
                foreach ($lots as $i => $l) {
                    if (bccomp($need, '0', self::S) <= 0) break;
                    if ($l['settle'] > $t['txn_date'] || bccomp($l['qty'], '0', self::S) <= 0) continue;
                    $take = bccomp($l['qty'], $need, self::S) > 0 ? $need : $l['qty'];
                    $matched = bcadd($matched, bcmul($take, $l['gross'], self::S), self::S);
                    $lots[$i]['qty'] = bcsub($l['qty'], $take, self::S);
                    $need = bcsub($need, $take, self::S);
                }
                // lượt 2: lô còn lại BẤT KỂ settle — cho phép bán vượt, chỉ cảnh báo (dòng 1208)
                foreach ($lots as $i => $l) {
                    if (bccomp($need, '0', self::S) <= 0) break;
                    if (bccomp($lots[$i]['qty'], '0', self::S) <= 0) continue;
                    $cur  = $lots[$i]['qty'];
                    $take = bccomp($cur, $need, self::S) > 0 ? $need : $cur;
                    $matched = bcadd($matched, bcmul($take, $l['gross'], self::S), self::S);
                    $lots[$i]['qty'] = bcsub($cur, $take, self::S);
                    $need = bcsub($need, $take, self::S);
                }
                $left     = bccomp($need, '0', self::S) > 0 ? $need : '0';
                $sold_qty = bcsub($qty, $left, self::S);
                $proceeds_b = bcmul(bcmul($sold_qty, $price, self::S), $rate_out, self::S);
                $row_pl   = bcsub($proceeds_b, $matched, self::S);
                $cum_pl   = bcadd($cum_pl, $row_pl, self::S);
                $cash     = $proceeds_b;
                $net_sell = bcadd($net_sell, $proceeds_b, self::S);
            }

            // remain = tổng lô CỦA MÃ ĐÓ (dòng 1214)
            $remain = '0';
            foreach ($lots as $l) $remain = bcadd($remain, $l['qty'], self::S);

            $flow[] = [
                'id'          => (string) $t['id'],
                'sym'         => $sym,
                'txn_type'    => $t['txn_type'],
                'txn_date'    => $t['txn_date'],
                'qty'         => GDSFIN_Util::qty_out($qty),
                'price'       => GDSFIN_Util::money_out($price),
                'settle_date' => $settle,
                't2_state'    => $t2_state,
                't2_avail'    => $t2_avail === null ? null : GDSFIN_Util::qty_out($t2_avail),
                'cash'        => GDSFIN_Util::money_out($cash),
                'row_pl'      => $row_pl === null ? null : GDSFIN_Util::money_out($row_pl),
                'cum_pl'      => GDSFIN_Util::money_out($cum_pl),
                'remain'      => GDSFIN_Util::qty_out($remain),
            ];
            unset($a, $lots);
        }

        // --- Tổng hợp engine A (gốc dòng 1137-1154) ---
        $total_realized = '0'; $total_sold_base = '0'; $held = 0;
        $by_sym = [];
        $syms = array_keys($acc);
        sort($syms);
        foreach ($syms as $sym) {
            $a = $acc[$sym];
            $total_realized  = bcadd($total_realized, $a['realized'], self::S);
            $total_sold_base = bcadd($total_sold_base, $a['sold_base'], self::S);
            $has = bccomp($a['shares'], '0.0001', self::S) > 0;
            if ($has) $held++;

            $by_sym[] = [
                'sym'          => $sym,
                'shares'       => GDSFIN_Util::qty_out($a['shares']),
                'avg_cost'     => $has ? GDSFIN_Util::money_out(bcdiv($a['cost'], $a['shares'], self::S)) : null,
                'net_value'    => GDSFIN_Util::money_out($a['cost']),
                'sold'         => GDSFIN_Util::qty_out($a['sold']),
                'realized'     => GDSFIN_Util::money_out($a['realized']),
                'realized_pct' => bccomp($a['sold_base'], '0', self::S) > 0
                    ? GDSFIN_Util::pct_out(bcmul(bcdiv($a['realized'], $a['sold_base'], self::S), '100', self::S))
                    : null,
            ];
        }

        $flow_remain = '0';
        foreach ($lots_by_sym as $ls) {
            foreach ($ls as $l) $flow_remain = bcadd($flow_remain, $l['qty'], self::S);
        }

        // footer trả CẢ HAI số + phơi chỗ lệch (quyết định thiết kế, xem mục 3)
        $diff = bcsub($cum_pl, $total_realized, self::S);

        return [
            'cards' => [
                'total_realized'     => GDSFIN_Util::money_out($total_realized),
                'total_realized_pct' => bccomp($total_sold_base, '0', self::S) > 0
                    ? GDSFIN_Util::pct_out(bcmul(bcdiv($total_realized, $total_sold_base, self::S), '100', self::S))
                    : null,
                'total_net_buy'      => GDSFIN_Util::money_out($net_buy),
                'total_net_sell'     => GDSFIN_Util::money_out($net_sell),
                'held_count'         => $held,
                'total_fees'         => GDSFIN_Util::money_out($total_fees),
            ],
            'by_sym' => $by_sym,
            'flow'   => $flow,
            'footer' => [
                'flow_remain'      => GDSFIN_Util::qty_out($flow_remain),
                'cum_pl'           => GDSFIN_Util::money_out($cum_pl),
                'total_realized'   => GDSFIN_Util::money_out($total_realized),
                'engines_diverge'  => bccomp($diff, '0', 4) !== 0,
                'engines_diff'     => GDSFIN_Util::money_out($diff),
            ],
        ];
    }
}
