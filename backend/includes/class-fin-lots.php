<?php
defined('ABSPATH') || exit;

/**
 * Engine C — khớp lô đích danh. Cài theo docs/api-spec.md mục 7.
 *
 * RANH GIỚI (mục 7.1): module này CHỈ sinh ra chi tiết "lệnh bán nào ăn vào lô mua
 * nào". Nó KHÔNG được đụng vào bất kỳ số tổng nào của engine A (by_sym, cards) hay
 * engine B (flow, footer). Vì vậy nó nằm ở file RIÊNG và GDSFIN_Stock::compute()
 * không gọi tới nó một dòng nào — ranh giới được bảo đảm bằng cấu trúc, không phải
 * bằng lời hứa trong comment.
 *
 * Thứ tự khớp (mục 7.9): giá vốn TĂNG DẦN — lô rẻ nhất / lãi cao nhất trước.
 * Vẫn cho user ghim tay qua `lot_matches`, các dòng ghim mang is_manual = 1 và
 * không bị các lần khớp lại về sau ghi đè.
 */
class GDSFIN_Lots {

    const S = GDSFIN_Util::S;

    /* ===================== BẢNG ===================== */

    public static function create_tables() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        $p = $wpdb->prefix;

        // KHÔNG có cột cost_matched: giá vốn tính lúc đọc từ buy_txn_id (mục 7.2).
        // Lưu số đã tính thì nó đóng băng và lệch khỏi engine A/B khi sửa biểu phí.
        $sql = "CREATE TABLE {$p}fin_stock_lot_matches (
            id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            sell_txn_id  BIGINT UNSIGNED NOT NULL,
            buy_txn_id   BIGINT UNSIGNED NOT NULL,
            qty          BIGINT UNSIGNED NOT NULL,
            is_manual    TINYINT(1)      NOT NULL DEFAULT 0,
            created_at   DATETIME        NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY uq_sell_buy (sell_txn_id, buy_txn_id),
            KEY idx_sell (sell_txn_id),
            KEY idx_buy (buy_txn_id)
        ) $charset;";

        dbDelta($sql);
    }

    private static function t()     { global $wpdb; return $wpdb->prefix . 'fin_stock_lot_matches'; }
    private static function t_txn() { global $wpdb; return $wpdb->prefix . 'fin_stock_txns'; }

    /* ===================== ROUTES ===================== */

    public static function register_routes() {
        register_rest_route('fin/v1', '/fin/stock-txns/(?P<id>\d+)/lots', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'detail'],
            'permission_callback' => fn() => current_user_can('fin_view'),
        ]);
    }

    /* ===================== BIỂU PHÍ ===================== */

    /** @var array<string,array> memo theo user|ngày, tránh N query khi có nhiều lô */
    private static $rate_memo = [];

    /**
     * Mốc phí tại ngày $d. Đi qua GDSFIN_Stock::rate_at() CHỦ Ý: dùng đúng một
     * đường chọn mốc với engine A/B, không cài lại rate_for ở đây để khỏi lệch.
     */
    private static function rate_on(int $uid, string $d): array {
        $k = $uid . '|' . $d;
        if (!isset(self::$rate_memo[$k])) {
            self::$rate_memo[$k] = GDSFIN_Stock::rate_at($uid, $d);
        }
        return self::$rate_memo[$k];
    }

    /** Giá vốn 1 cp của lô mua = price × (1 + buyFee ngày mua) — mục 2.2. */
    private static function unit_cost(int $uid, array $buy): string {
        $rt = self::rate_on($uid, $buy['txn_date']);
        $bf = bcdiv($rt['buy_fee'], '100', self::S);
        return bcmul($buy['price'], bcadd('1', $bf, self::S), self::S);
    }

    /** Đơn giá bán ròng = price × (1 − sellFee − tax) ngày bán — mục 2.3. */
    private static function net_unit(int $uid, array $sell): string {
        $rt = self::rate_on($uid, $sell['txn_date']);
        $sf = bcdiv($rt['sell_fee'], '100', self::S);
        $tx = bcdiv($rt['tax'],      '100', self::S);
        return bcmul($sell['price'], bcsub('1', bcadd($sf, $tx, self::S), self::S), self::S);
    }

    /* ===================== ĐỌC LÔ ===================== */

    /**
     * Các lô MUA của một mã kèm số còn CHƯA khớp, đã sắp theo thứ tự khớp của
     * engine C: giá vốn tăng dần → txn_date sớm hơn → id nhỏ hơn (mục 7.3 bước 2).
     *
     * $upto  : chỉ lấy lô có txn_date <= ngày này (ngày bán). null = mọi lô.
     * Chỉ đếm phần đã khớp của các lệnh bán còn 'posted': dòng match của lệnh bán
     * đã void bị xoá khi void, điều kiện join này là lớp phòng vệ thứ hai.
     */
    private static function buy_lots(int $uid, string $sym, ?string $upto): array {
        global $wpdb;
        $tt = self::t_txn(); $tm = self::t();

        $where = $upto === null ? '' : $wpdb->prepare(' AND b.txn_date <= %s', $upto);
        $rows  = $wpdb->get_results($wpdb->prepare(
            "SELECT b.id, b.txn_date, b.qty, b.price,
                    COALESCE((SELECT SUM(m.qty) FROM $tm m
                               JOIN $tt s ON s.id = m.sell_txn_id AND s.status = 'posted'
                              WHERE m.buy_txn_id = b.id), 0) AS used
               FROM $tt b
              WHERE b.user_id = %d AND b.sym = %s
                AND b.txn_type = 'buy' AND b.status = 'posted' {$where}",
            $uid, $sym
        ), ARRAY_A) ?: [];

        $lots = [];
        foreach ($rows as $r) {
            $left = bcsub((string) $r['qty'], (string) $r['used'], 0);
            if (bccomp($left, '0', 0) <= 0) continue;
            $lots[] = [
                'id'        => (int) $r['id'],
                'txn_date'  => $r['txn_date'],
                'price'     => (string) $r['price'],
                'left'      => $left,
                'unit_cost' => self::unit_cost($uid, $r),
            ];
        }

        usort($lots, function ($x, $y) {
            $c = bccomp($x['unit_cost'], $y['unit_cost'], self::S);
            if ($c !== 0) return $c;                          // rẻ nhất trước
            if ($x['txn_date'] !== $y['txn_date']) return strcmp($x['txn_date'], $y['txn_date']);
            return $x['id'] <=> $y['id'];
        });
        return $lots;
    }

    /* ===================== KHỚP ===================== */

    /** Lệnh bán này có dòng ghim tay không. Ghim tay thì không được tự khớp lại. */
    private static function is_pinned(int $sell_id): bool {
        global $wpdb;
        return (bool) $wpdb->get_var($wpdb->prepare(
            "SELECT 1 FROM " . self::t() . " WHERE sell_txn_id = %d AND is_manual = 1 LIMIT 1", $sell_id
        ));
    }

    private static function drop_auto(int $sell_id): void {
        global $wpdb;
        $wpdb->query($wpdb->prepare(
            "DELETE FROM " . self::t() . " WHERE sell_txn_id = %d AND is_manual = 0", $sell_id
        ));
    }

    private static function insert_match(int $sell_id, int $buy_id, string $qty, bool $manual): void {
        global $wpdb;
        $wpdb->insert(self::t(), [
            'sell_txn_id' => $sell_id,
            'buy_txn_id'  => $buy_id,
            'qty'         => $qty,
            'is_manual'   => $manual ? 1 : 0,
            'created_at'  => GDSFIN_Util::now_mysql(),
        ]);
    }

    /**
     * Khớp tự động một lệnh bán theo 7.3. Ghi đè các dòng auto cũ của chính nó.
     * Bán vượt số lô có sẵn: ghi phần khớp được, phần thiếu KHÔNG tạo dòng match
     * (nhất quán engine B — bán vượt vẫn cho, chỉ cảnh báo).
     */
    private static function auto_match(int $uid, array $sell): void {
        self::drop_auto((int) $sell['id']);

        $need = (string) $sell['qty'];
        foreach (self::buy_lots($uid, $sell['sym'], $sell['txn_date']) as $lot) {
            if (bccomp($need, '0', 0) <= 0) break;
            $take = bccomp($lot['left'], $need, 0) > 0 ? $need : $lot['left'];
            self::insert_match((int) $sell['id'], $lot['id'], $take, false);
            $need = bcsub($need, $take, 0);
        }
    }

    /**
     * Khớp lại các lệnh bán AUTO của một mã, từ $from_date trở đi (mục 7.7).
     *
     * Hai lượt có lý do: xoá hết dòng auto trước rồi mới khớp lại, để phân bổ đi
     * theo thứ tự NGÀY BÁN chứ không theo thứ tự tình cờ của vòng lặp. Dòng ghim
     * tay không bị xoá và vẫn chiếm chỗ của lô, nên lựa chọn của user được giữ.
     */
    public static function rematch_symbol(int $uid, string $sym, string $from_date): void {
        global $wpdb;
        $sells = $wpdb->get_results($wpdb->prepare(
            "SELECT id, sym, txn_date, qty, price FROM " . self::t_txn() . "
              WHERE user_id = %d AND sym = %s AND txn_type = 'sell'
                AND status = 'posted' AND txn_date >= %s
              ORDER BY txn_date ASC, id ASC",
            $uid, $sym, $from_date
        ), ARRAY_A) ?: [];

        $todo = [];
        foreach ($sells as $s) {
            if (self::is_pinned((int) $s['id'])) continue;
            self::drop_auto((int) $s['id']);
            $todo[] = $s;
        }
        foreach ($todo as $s) self::auto_match($uid, $s);
    }

    /**
     * Khớp bù cho sổ lệnh CÓ TRƯỚC khi engine C tồn tại.
     *
     * Khớp tự động chỉ chạy lúc tạo lệnh, nên mọi lệnh bán đã nằm trong sổ từ trước
     * sẽ không có dòng match nào và endpoint /lots sẽ báo matched_qty = 0 — sai.
     * Chạy đúng MỘT LẦN cho mỗi user, đánh dấu bằng user_meta.
     *
     * Không khớp bù lười theo từng lệnh bán khi user mở: làm vậy thì phân bổ phụ
     * thuộc vào việc user bấm xem lệnh nào trước, hai người xem hai thứ tự sẽ ra hai
     * kết quả khác nhau. Khớp cả mã một lượt theo ngày bán tăng dần mới xác định.
     */
    const BACKFILL_META = 'gdsfin_lots_backfilled';

    public static function ensure_backfilled(int $uid): void {
        global $wpdb;
        if (get_user_meta($uid, self::BACKFILL_META, true)) return;

        $syms = $wpdb->get_col($wpdb->prepare(
            "SELECT DISTINCT sym FROM " . self::t_txn() . "
              WHERE user_id = %d AND status = 'posted' AND txn_type = 'sell'", $uid
        )) ?: [];
        foreach ($syms as $sym) self::rematch_symbol($uid, $sym, '1970-01-01');

        update_user_meta($uid, self::BACKFILL_META, GDSFIN_Util::now_mysql());
    }

    /* ===================== GHIM TAY ===================== */

    /**
     * Kiểm `lot_matches` do client gửi (mục 7.5). Trả mảng đã chuẩn hoá hoặc WP_Error.
     * Chạy TRƯỚC khi insert lệnh bán, nên lỗi không để lại bản ghi rác nào.
     */
    public static function validate_manual(int $uid, string $sym, string $sell_date, string $sell_qty, $raw) {
        if (!is_array($raw) || !$raw) {
            return new WP_Error('bad_lots', 'lot_matches phải là mảng không rỗng', ['status' => 400]);
        }

        $avail = [];
        foreach (self::buy_lots($uid, $sym, $sell_date) as $lot) $avail[$lot['id']] = $lot['left'];

        $pairs = []; $seen = []; $sum = '0';
        foreach ($raw as $i => $row) {
            $bid = isset($row['buy_txn_id']) ? absint($row['buy_txn_id']) : 0;
            $q   = isset($row['qty']) ? (string) $row['qty'] : '';
            if (!$bid) {
                return new WP_Error('bad_lots', "lot_matches[$i]: thiếu buy_txn_id", ['status' => 400]);
            }
            if (isset($seen[$bid])) {
                return new WP_Error('bad_lots', "lot_matches: buy_txn_id $bid xuất hiện hai lần", ['status' => 400]);
            }
            if (!ctype_digit($q) || bccomp($q, '0', 0) <= 0) {
                return new WP_Error('bad_lots', "lot_matches[$i]: qty phải là số nguyên > 0", ['status' => 400]);
            }
            if (!isset($avail[$bid])) {
                // Gộp bốn lý do vào một thông báo có ích: không thuộc user, khác mã,
                // không phải lệnh mua, đã void, hoặc mua SAU ngày bán.
                return new WP_Error('bad_lots',
                    "lot_matches: lệnh mua $bid không dùng được — phải là lệnh mua $sym của bạn, "
                    . "status posted, ngày mua <= $sell_date, và còn hàng chưa khớp",
                    ['status' => 400]);
            }
            if (bccomp($q, $avail[$bid], 0) > 0) {
                return new WP_Error('bad_lots',
                    "lot_matches: lô $bid chỉ còn {$avail[$bid]} cp chưa khớp, không thể khớp $q",
                    ['status' => 400]);
            }
            $seen[$bid] = true;
            $sum = bcadd($sum, $q, 0);
            $pairs[] = ['buy_txn_id' => $bid, 'qty' => $q];
        }

        // Thiếu hoặc thừa đều 400 — KHÔNG tự bù phần còn lại (mục 7.5).
        if (bccomp($sum, $sell_qty, 0) !== 0) {
            return new WP_Error('bad_lots',
                "lot_matches: tổng qty = $sum, phải đúng bằng qty lệnh bán = $sell_qty",
                ['status' => 400]);
        }
        return $pairs;
    }

    public static function write_manual(int $sell_id, array $pairs): void {
        foreach ($pairs as $p) self::insert_match($sell_id, (int) $p['buy_txn_id'], $p['qty'], true);
    }

    /* ===================== MÓC VÀO SỔ LỆNH ===================== */

    /** Gọi sau khi thêm một lệnh (mua hay bán) — mục 7.7 hàng 3 và 4. */
    public static function on_txn_created(int $uid, string $sym, string $txn_date): void {
        self::rematch_symbol($uid, $sym, $txn_date);
    }

    /**
     * Gọi TRƯỚC khi void. Trả WP_Error 409 nếu là lệnh MUA đang bị khớp — mục 7.7.
     * Void lệnh mua khi vẫn có lệnh bán trỏ vào nó sẽ để lại dòng match mồ côi và
     * ra giá vốn vô nghĩa, nên chặn và nói rõ phải void lệnh bán nào trước.
     */
    public static function guard_void(int $uid, array $txn) {
        global $wpdb;
        if ($txn['txn_type'] !== 'buy') return null;

        $tm = self::t(); $tt = self::t_txn();
        $ids = $wpdb->get_col($wpdb->prepare(
            "SELECT DISTINCT m.sell_txn_id FROM $tm m
               JOIN $tt s ON s.id = m.sell_txn_id AND s.status = 'posted'
              WHERE m.buy_txn_id = %d ORDER BY m.sell_txn_id ASC",
            (int) $txn['id']
        )) ?: [];

        if (!$ids) return null;
        return new WP_Error('lot_dependency',
            'Không void được lệnh mua này: đang bị khớp bởi lệnh bán ' . implode(', ', $ids)
            . '. Void lệnh bán trước.',
            ['status' => 409, 'sell_txn_ids' => array_map('strval', $ids)]);
    }

    /**
     * Gọi SAU khi void thành công. Lệnh bán: xoá dòng match của nó (dữ liệu dẫn
     * xuất, không phải sổ gốc) rồi khớp lại phần auto vì lô vừa được giải phóng.
     */
    public static function after_void(int $uid, array $txn): void {
        global $wpdb;
        if ($txn['txn_type'] === 'sell') {
            $wpdb->query($wpdb->prepare(
                "DELETE FROM " . self::t() . " WHERE sell_txn_id = %d", (int) $txn['id']
            ));
        }
        self::rematch_symbol($uid, $txn['sym'], $txn['txn_date']);
    }

    /* ===================== BẤT BIẾN ===================== */

    /**
     * Σ qty khớp theo từng buy_txn_id phải <= qty của lệnh mua đó (mục 7.7).
     * Trả mảng các vi phạm — rỗng là đạt. Dùng trong test.
     */
    public static function check_invariant(int $uid): array {
        global $wpdb;
        $tm = self::t(); $tt = self::t_txn();
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT b.id, b.sym, b.qty, SUM(m.qty) AS used
               FROM $tm m
               JOIN $tt b ON b.id = m.buy_txn_id
               JOIN $tt s ON s.id = m.sell_txn_id AND s.status = 'posted'
              WHERE b.user_id = %d
              GROUP BY b.id, b.sym, b.qty
             HAVING SUM(m.qty) > b.qty", $uid
        ), ARRAY_A) ?: [];
        return $rows;
    }

    /* ===================== ENDPOINT ===================== */

    public static function detail(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $id  = absint($req['id']);

        self::ensure_backfilled($uid);

        $txn = $wpdb->get_row($wpdb->prepare(
            "SELECT id, sym, txn_type, txn_date, qty, price, status FROM " . self::t_txn() . "
              WHERE id = %d AND user_id = %d", $id, $uid
        ), ARRAY_A);

        // Không thuộc user -> 404 chứ không 403, để không tiết lộ id nào tồn tại (mục 0.2).
        if (!$txn) {
            return new WP_Error('not_found', 'Không tìm thấy giao dịch', ['status' => 404]);
        }
        if ($txn['txn_type'] !== 'sell') {
            return new WP_Error('not_sell', 'Endpoint này chỉ dùng cho lệnh BÁN', ['status' => 400]);
        }
        if ($txn['status'] !== 'posted') {
            return new WP_Error('not_found', 'Lệnh bán đã void, không còn chi tiết khớp lô', ['status' => 404]);
        }

        $net = self::net_unit($uid, $txn);

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT m.buy_txn_id, m.qty, m.is_manual, b.txn_date AS buy_date, b.price AS buy_price
               FROM " . self::t() . " m
               JOIN " . self::t_txn() . " b ON b.id = m.buy_txn_id
              WHERE m.sell_txn_id = %d", $id
        ), ARRAY_A) ?: [];

        $matches = [];
        foreach ($rows as $r) {
            $uc   = self::unit_cost($uid, ['txn_date' => $r['buy_date'], 'price' => $r['buy_price']]);
            $cost = bcmul((string) $r['qty'], $uc, self::S);
            $matches[] = [
                'buy_txn_id'   => (string) $r['buy_txn_id'],
                'buy_date'     => $r['buy_date'],
                'qty'          => GDSFIN_Util::qty_out((string) $r['qty']),
                'buy_price'    => GDSFIN_Util::money_out($r['buy_price']),
                'unit_cost'    => GDSFIN_Util::money_out($uc),
                'cost_matched' => GDSFIN_Util::money_out($cost),
                'pl'           => GDSFIN_Util::money_out(
                    bcsub(bcmul((string) $r['qty'], $net, self::S), $cost, self::S)
                ),
                // Lô chưa về VẪN tính lãi, chỉ gắn cờ để UI hiện badge (mục 7.4)
                'settled'      => GDSFIN_Util::add_trading_days($r['buy_date'], 2) <= $txn['txn_date'],
                'settle_date'  => GDSFIN_Util::add_trading_days($r['buy_date'], 2),
                'is_manual'    => (bool) (int) $r['is_manual'],
                '_uc'          => $uc,
            ];
        }

        // Sắp theo đúng thứ tự đã khớp: giá vốn tăng dần, rồi ngày mua, rồi id.
        usort($matches, function ($x, $y) {
            $c = bccomp($x['_uc'], $y['_uc'], self::S);
            if ($c !== 0) return $c;
            if ($x['buy_date'] !== $y['buy_date']) return strcmp($x['buy_date'], $y['buy_date']);
            return (int) $x['buy_txn_id'] <=> (int) $y['buy_txn_id'];
        });

        $matched_qty = '0'; $matched_pl = '0';
        foreach ($matches as $m) {
            $matched_qty = bcadd($matched_qty, $m['qty'], 0);
            $matched_pl  = bcadd($matched_pl, $m['pl'], self::S);
            unset($m);
        }
        foreach ($matches as $i => $m) unset($matches[$i]['_uc']);

        return rest_ensure_response([
            'sell_txn_id'    => (string) $txn['id'],
            'sym'            => $txn['sym'],
            'txn_date'       => $txn['txn_date'],
            'qty'            => GDSFIN_Util::qty_out((string) $txn['qty']),
            'price'          => GDSFIN_Util::money_out($txn['price']),
            'net_unit_price' => GDSFIN_Util::money_out($net),
            'matched_qty'    => GDSFIN_Util::qty_out($matched_qty),
            'unmatched_qty'  => GDSFIN_Util::qty_out(bcsub((string) $txn['qty'], $matched_qty, 0)),
            'matches'        => array_values($matches),
            // CHỈ là thông tin của lệnh bán này. Không được cộng vào tổng nào của
            // engine A/B — xem bảng ranh giới mục 7.1.
            'matched_pl'     => GDSFIN_Util::money_out($matched_pl),
            'engine'         => 'C',
            'engine_note'    => 'Khớp lô rẻ nhất trước. Số này KHÁC engine A (bình quân gia quyền) '
                              . 'và engine B (FIFO) — không phải lỗi, xem remaining.',
            'remaining'      => self::remaining($uid, $txn['sym']),
        ]);
    }

    /**
     * Phần CÒN NẮM của mã, theo cách nhìn engine C.
     *
     * BẮT BUỘC đi kèm matched_pl (mục 7.6): khớp lô rẻ trước luôn làm sổ đã chốt
     * đẹp lên và đẩy lô giá cao ở lại danh mục. Chênh lệch không biến mất, nó
     * chuyển sang đây. Hiện matched_pl mà giấu remaining là báo cáo sai một nửa.
     */
    private static function remaining(int $uid, string $sym): array {
        $lots = self::buy_lots($uid, $sym, null);

        $qty = '0'; $cost = '0'; $out = [];
        foreach ($lots as $l) {
            $c    = bcmul($l['left'], $l['unit_cost'], self::S);
            $qty  = bcadd($qty, $l['left'], 0);
            $cost = bcadd($cost, $c, self::S);
            $out[] = [
                'buy_txn_id' => (string) $l['id'],
                'buy_date'   => $l['txn_date'],
                'qty'        => GDSFIN_Util::qty_out($l['left']),
                'unit_cost'  => GDSFIN_Util::money_out($l['unit_cost']),
                'cost_basis' => GDSFIN_Util::money_out($c),
            ];
        }

        // Giá thị trường: mục 8/9 đã cài nên chỗ này KHÔNG còn trả null vô điều kiện
        // như 7.9b viết. Vẫn giữ nguyên luật "không có giá thì null, không bịa số".
        $q = GDSFIN_Market::quotes_for([$sym])[$sym] ?? null;

        $market = null; $unreal = null;
        if ($q !== null && bccomp($qty, '0', 0) > 0) {
            $rt = self::rate_on($uid, GDSFIN_Util::today());
            $sf = bcdiv($rt['sell_fee'], '100', self::S);
            $tx = bcdiv($rt['tax'],      '100', self::S);
            $market = $q['close_price'];
            // Trừ sẵn phí bán để so CÙNG CƠ SỞ với matched_pl (đã trừ phí) — mục 7.6
            $gross  = bcmul(bcmul($qty, $market, self::S), bcsub('1', bcadd($sf, $tx, self::S), self::S), self::S);
            $unreal = bcsub($gross, $cost, self::S);
        }

        return [
            'qty'           => GDSFIN_Util::qty_out($qty),
            'cost_basis'    => GDSFIN_Util::money_out($cost),
            'market_price'  => $market === null ? null : GDSFIN_Util::money_out($market),
            'unrealized_pl' => $unreal === null ? null : GDSFIN_Util::money_out($unreal),
            // Nguồn gốc giá — mục 9.1: UI không được hiện giá mà giấu nguồn.
            'price'         => $q,
            'lots'          => $out,
        ];
    }
}
