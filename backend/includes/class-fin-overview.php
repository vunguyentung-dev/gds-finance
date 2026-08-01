<?php
defined('ABSPATH') || exit;

/**
 * Endpoint gộp cho màn Tổng quan — docs/api-spec.md mục 8.8.
 *
 * Mọi thẻ KPI trả dạng {value, available, reason} thay vì một con số, để UI phân
 * biệt được "bằng 0" với "không biết". Thiếu giá thì trả null kèm lý do, KHÔNG
 * lấy giá vốn thay giá thị trường (mục 8.4).
 */
class GDSFIN_Overview {

    const S = GDSFIN_Util::S;
    const SPARK_POINTS = 7;

    public static function register_routes() {
        register_rest_route('fin/v1', '/fin/overview', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'get_overview'],
            'permission_callback' => fn() => current_user_can('fin_view'),
        ]);
    }

    private static function card($value, bool $available, ?string $reason): array {
        return ['value' => $available ? $value : null, 'available' => $available, 'reason' => $reason];
    }

    /** KL nắm giữ tại từng ngày, khớp cách cắt của engine A (min(bán, đang giữ)). */
    private static function shares_timeline(int $uid): array {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT sym, txn_type, txn_date, qty FROM {$wpdb->prefix}fin_stock_txns
              WHERE user_id = %d AND status = 'posted'
              ORDER BY txn_date ASC, id ASC", $uid
        ), ARRAY_A) ?: [];
        return $rows;
    }

    private static function shares_at(array $txns, string $date): array {
        $sh = [];
        foreach ($txns as $t) {
            if ($t['txn_date'] > $date) break;
            $sym = $t['sym'];
            $cur = $sh[$sym] ?? '0';
            if ($t['txn_type'] === 'buy') {
                $sh[$sym] = bcadd($cur, (string) $t['qty'], 0);
            } else {
                $take = bccomp((string) $t['qty'], $cur, 0) > 0 ? $cur : (string) $t['qty'];
                $sh[$sym] = bcsub($cur, $take, 0);
            }
        }
        return array_filter($sh, fn($v) => bccomp($v, '0', 0) > 0);
    }

    private static function trading_days_between(string $from, string $to): int {
        $h = GDSFIN_Util::holidays();
        $d = new DateTimeImmutable($from . ' 00:00:00', GDSFIN_Util::tz());
        $e = new DateTimeImmutable($to . ' 00:00:00', GDSFIN_Util::tz());
        $n = 0;
        while ($d <= $e) {
            $wd = (int) $d->format('N');
            if ($wd < 6 && !isset($h[$d->format('Y-m-d')])) $n++;
            $d = $d->modify('+1 day');
        }
        return $n;
    }

    public static function get_overview(WP_REST_Request $req) {
        global $wpdb;
        $uid   = get_current_user_id();
        $stock = GDSFIN_Stock::compute($uid);
        $rate  = GDSFIN_Stock::rate_at($uid);
        $sf    = bcdiv($rate['sell_fee'], '100', self::S);
        $tx    = bcdiv($rate['tax'], '100', self::S);
        $exit_rate = bcadd($sf, $tx, self::S);

        // Mã đang nắm — lấy từ engine A để khớp tuyệt đối với màn Giao dịch
        $held = [];
        foreach ($stock['by_sym'] as $s) {
            if (bccomp($s['shares'], '0', 0) > 0) $held[$s['sym']] = $s;
        }
        $syms   = array_keys($held);
        $quotes = GDSFIN_Market::quotes_for($syms);
        $meta   = GDSFIN_Market::sectors_of($syms);
        $cash   = GDSFIN_Cash::summary($uid, $stock['cards']);
        $ltd    = GDSFIN_Market::last_trading_day();

        $t_hist = $wpdb->prefix . 'fin_quote_history';

        $holdings = [];
        $missing  = [];
        $mkt_total = '0';
        $sess_pl   = '0';
        $sess_base = '0';
        $all_priced = true;
        $all_have_prev = true;

        foreach ($syms as $sym) {
            $s   = $held[$sym];
            $qty = (string) $s['shares'];
            $cost = (string) $s['net_value'];
            $q   = $quotes[$sym] ?? null;
            $priced = $q !== null && $q['close'] !== null;

            if (!$priced) { $all_priced = false; $missing[] = $sym; }

            $mv = $fee = $upl = $upct = null;
            if ($priced) {
                $mv  = bcmul($qty, $q['close'], self::S);
                $fee = bcmul($mv, $exit_rate, self::S);
                $upl = bcsub(bcsub($mv, $fee, self::S), $cost, self::S);
                $upct = bccomp($cost, '0', self::S) > 0
                    ? GDSFIN_Util::pct_out(bcmul(bcdiv($upl, $cost, self::S), '100', self::S))
                    : null;
                $mkt_total = bcadd($mkt_total, $mv, self::S);

                if ($q['prev_close'] !== null) {
                    $sess_pl   = bcadd($sess_pl, bcmul($qty, bcsub($q['close'], $q['prev_close'], self::S), self::S), self::S);
                    $sess_base = bcadd($sess_base, bcmul($qty, $q['prev_close'], self::S), self::S);
                } else {
                    $all_have_prev = false;
                }
            } else {
                $all_have_prev = false;
            }

            // sparkline: các close THỰC CÓ, không nội suy (mục 8.11)
            $sp = $wpdb->get_results($wpdb->prepare(
                "SELECT trade_date, close FROM $t_hist WHERE sym = %s ORDER BY trade_date DESC LIMIT %d",
                $sym, self::SPARK_POINTS
            ), ARRAY_A) ?: [];
            $sp = array_reverse($sp);

            $holdings[] = [
                'sym'            => $sym,
                'name'           => $meta[$sym]['name'] ?? null,
                'sector'         => $meta[$sym]['sector'] ?? null,
                'qty'            => GDSFIN_Util::qty_out($qty),
                'avg_cost'       => $s['avg_cost'],
                'cost_value'     => GDSFIN_Util::money_out($cost),
                'last'           => $priced ? $q['close'] : null,
                'trade_date'     => $priced ? $q['trade_date'] : null,
                'market_value'   => $mv  === null ? null : GDSFIN_Util::money_out($mv),
                'exit_fee_est'   => $fee === null ? null : GDSFIN_Util::money_out($fee),
                'unrealized_pl'  => $upl === null ? null : GDSFIN_Util::money_out($upl),
                'unrealized_pct' => $upct,
                'priced'         => $priced,
                'price_source'   => $priced ? $q['source'] : null,
                'spark'          => array_map(fn($r) => GDSFIN_Util::money_out($r['close']), $sp),
                'spark_from'     => $sp ? $sp[0]['trade_date'] : null,
                'spark_to'       => $sp ? $sp[count($sp) - 1]['trade_date'] : null,
            ];
        }

        // ---- Thẻ KPI ----
        $miss_txt = $missing ? 'thiếu giá: ' . implode(', ', $missing) : null;

        // Chưa thiết lập tài khoản tiền thì balance không có nghĩa là số dư (xem
        // ghi chú 'configured' ở GDSFIN_Cash::summary), nên Tổng tài sản cũng chưa tính được.
        $cash_ok  = !empty($cash['configured']);
        $cash_why = 'chưa thiết lập tài khoản tiền — thêm ở màn Cài đặt';

        $asset_ok = $all_priced && $cash_ok;
        $total_asset = self::card(
            $asset_ok ? GDSFIN_Util::money_out(bcadd($cash['balance'], $mkt_total, self::S)) : null,
            $asset_ok,
            $asset_ok ? null : trim(($all_priced ? '' : $miss_txt . ' · ') . ($cash_ok ? '' : $cash_why), ' ·')
        );

        $sess_ok = $all_priced && $all_have_prev && $syms;
        $last_session_pl = self::card(
            $sess_ok ? GDSFIN_Util::money_out($sess_pl) : null,
            (bool) $sess_ok,
            $sess_ok ? null : ($miss_txt ?: 'chưa có giá phiên trước để so sánh')
        );
        $last_session_pct = self::card(
            ($sess_ok && bccomp($sess_base, '0', self::S) > 0)
                ? GDSFIN_Util::pct_out(bcmul(bcdiv($sess_pl, $sess_base, self::S), '100', self::S)) : null,
            (bool) ($sess_ok && bccomp($sess_base, '0', self::S) > 0),
            $sess_ok ? null : ($miss_txt ?: 'chưa có giá phiên trước để so sánh')
        );

        // Cổ tức dự kiến/năm — KHÁC cổ tức đã nhận đang ghi ở fin_personal (mục 8.7)
        $year = GDSFIN_Util::year();
        $dps  = GDSFIN_Market::cash_dividend_per_share($syms, $year);
        $div_total = '0'; $has_div = false;
        foreach ($syms as $sym) {
            if (!isset($dps[$sym])) continue;
            $has_div = true;
            $div_total = bcadd($div_total, bcmul($held[$sym]['shares'], $dps[$sym], self::S), self::S);
        }
        $dividend_year = self::card(
            $has_div ? GDSFIN_Util::money_out($div_total) : null,
            $has_div,
            $has_div ? null : 'chưa có dữ liệu cổ tức cho mã đang nắm'
        );

        // ---- Phân bổ theo ngành (chỉ trên các mã CÓ giá) ----
        $by_sector = [];
        foreach ($holdings as $h) {
            if (!$h['priced']) continue;
            $key = ($h['sector'] === null || $h['sector'] === '') ? 'Chưa phân loại' : $h['sector'];
            $by_sector[$key] = bcadd($by_sector[$key] ?? '0', $h['market_value'], self::S);
        }
        $sector_alloc = [];
        foreach ($by_sector as $name => $val) {
            $sector_alloc[] = [
                'sector' => $name,
                'value'  => GDSFIN_Util::money_out($val),
                'pct'    => bccomp($mkt_total, '0', self::S) > 0
                    ? GDSFIN_Util::pct_out(bcmul(bcdiv($val, $mkt_total, self::S), '100', self::S)) : null,
            ];
        }
        usort($sector_alloc, fn($a, $b) => bccomp($b['value'], $a['value'], 4));

        // ---- Đường giá trị danh mục ----
        $days = max(1, min(365, (int) ($req->get_param('days') ?: 90)));
        $to   = $ltd;
        $from = (new DateTimeImmutable($to . ' 00:00:00', GDSFIN_Util::tz()))->modify("-{$days} day")->format('Y-m-d');
        $txns = self::shares_timeline($uid);

        $dates = $wpdb->get_col($wpdb->prepare(
            "SELECT DISTINCT trade_date FROM $t_hist WHERE trade_date BETWEEN %s AND %s ORDER BY trade_date ASC",
            $from, $to
        )) ?: [];

        $series = [];
        foreach ($dates as $d) {
            $sh = self::shares_at($txns, $d);
            if (!$sh) continue;
            $val = '0'; $complete = true;
            foreach ($sh as $sym => $qty) {
                $close = $wpdb->get_var($wpdb->prepare(
                    "SELECT close FROM $t_hist WHERE sym = %s AND trade_date = %s", $sym, $d
                ));
                if ($close === null) { $complete = false; break; }   // thiếu 1 mã -> bỏ phiên
                $val = bcadd($val, bcmul($qty, (string) $close, self::S), self::S);
            }
            if ($complete) $series[] = ['trade_date' => $d, 'value' => GDSFIN_Util::money_out($val)];
        }

        return rest_ensure_response([
            'as_of'            => GDSFIN_Util::now_mysql(),
            'last_trading_day' => $ltd,
            'price_coverage'   => [
                'held'    => count($syms),
                'priced'  => count($syms) - count($missing),
                'missing' => $missing,
            ],
            'cards' => [
                'total_asset'          => $total_asset,
                'last_session_pl'      => $last_session_pl,
                'last_session_pl_pct'  => $last_session_pct,
                'cash_available'       => self::card($cash['balance'], $cash_ok, $cash_ok ? null : $cash_why),
                'dividend_year'        => $dividend_year,
                'realized_pl'          => self::card($stock['cards']['total_realized'], true, null),
            ],
            'holdings'      => $holdings,
            'sector_alloc'  => $sector_alloc,
            'portfolio_series' => $series,
            'series_coverage'  => [
                'points'        => count($series),
                'trading_days'  => self::trading_days_between($from, $to),
                'from'          => $from,
                'to'            => $to,
            ],
            'cash' => $cash,
        ]);
    }
}
