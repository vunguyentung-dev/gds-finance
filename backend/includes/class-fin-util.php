<?php
defined('ABSPATH') || exit;

/**
 * Helper dùng chung cho các module nghiệp vụ.
 * Xem docs/api-spec.md mục 0.1 (scale bcmath) và mục 2.4 (T+2).
 */
class GDSFIN_Util {

    /** Scale cho MỌI tính trung gian. bcdiv cắt cụt nên không được dùng scale 4. */
    const S = 10;

    /**
     * Cắt về scale 4 ở biên JSON, làm tròn HALF-UP.
     * bcmath không có hàm làm tròn: bcadd cắt cụt sau khi cộng 0.00005 -> thành half-up.
     */
    public static function money_out(string $v): string {
        $half = bccomp($v, '0', self::S) < 0 ? '-0.00005' : '0.00005';
        return bcadd($v, $half, 4);
    }

    /** Cắt về scale 2 cho phần trăm, half-up. */
    public static function pct_out(string $v): string {
        $half = bccomp($v, '0', self::S) < 0 ? '-0.005' : '0.005';
        return bcadd($v, $half, 2);
    }

    /** Số lượng cổ phiếu -> chuỗi nguyên. */
    public static function qty_out(string $v): string {
        return bcadd($v, '0', 0);
    }

    /** Danh sách ngày lễ, cache trong request. Bảng rỗng => chỉ bỏ T7/CN. */
    public static function holidays(): array {
        static $cache = null;
        if ($cache === null) {
            global $wpdb;
            $t = $wpdb->prefix . 'fin_market_holidays';
            $rows = $wpdb->get_col("SELECT holiday_date FROM $t");
            $cache = $rows ? array_fill_keys($rows, true) : [];
        }
        return $cache;
    }

    /**
     * Cộng n ngày làm việc: bỏ T7/CN và ngày trong fin_market_holidays.
     * Dùng timezone của site (giờ địa phương), KHÔNG dùng UTC để tránh lệch ngày.
     */
    public static function add_trading_days(string $iso, int $n): string {
        $d = new DateTimeImmutable($iso . ' 00:00:00', wp_timezone());
        $h = self::holidays();
        $added = 0;
        while ($added < $n) {
            $d  = $d->modify('+1 day');
            $wd = (int) $d->format('N');            // 1=T2 … 6=T7, 7=CN
            if ($wd >= 6) continue;
            if (isset($h[$d->format('Y-m-d')])) continue;
            $added++;
        }
        return $d->format('Y-m-d');
    }

    /** Ngày hợp lệ dạng Y-m-d. */
    public static function is_date(string $v): bool {
        $d = DateTimeImmutable::createFromFormat('!Y-m-d', $v);
        return $d && $d->format('Y-m-d') === $v;
    }
}
