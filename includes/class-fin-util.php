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
     * Múi giờ nghiệp vụ: GIỜ VIỆT NAM (GMT+7), KHÔNG dùng timezone của site.
     *
     * Cố ý không dùng wp_timezone()/current_time(): nếu site để UTC thì mọi mốc
     * thời gian lệch 7 tiếng, và trong khoảng 00:00-07:00 giờ VN còn lệch cả NGÀY
     * (06:00 ngày 02/08 giờ VN bị đóng dấu 01/08). Neo cứng vào giờ VN thì số liệu
     * đúng bất kể ai đổi setting site về sau.
     * Đổi được bằng filter 'gdsfin_timezone' nếu sau này phục vụ thị trường khác.
     */
    const TZ = 'Asia/Ho_Chi_Minh';

    public static function tz(): DateTimeZone {
        static $tz = null;
        if ($tz === null) {
            $name = (string) apply_filters('gdsfin_timezone', self::TZ);
            try {
                $tz = new DateTimeZone($name);
            } catch (Exception $e) {
                $tz = new DateTimeZone(self::TZ);
            }
        }
        return $tz;
    }

    public static function now(): DateTimeImmutable {
        return new DateTimeImmutable('now', self::tz());
    }

    /** Thay cho current_time('mysql'). */
    public static function now_mysql(): string {
        return self::now()->format('Y-m-d H:i:s');
    }

    /** Thay cho current_time('Y-m-d'). */
    public static function today(): string {
        return self::now()->format('Y-m-d');
    }

    /** Thay cho (int) current_time('Y'). */
    public static function year(): int {
        return (int) self::now()->format('Y');
    }

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
        $d = new DateTimeImmutable($iso . ' 00:00:00', self::tz());
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
