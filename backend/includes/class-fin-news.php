<?php
defined('ABSPATH') || exit;

/**
 * Module Tin tức — nạp RSS. Cài theo docs/api-spec.md mục 13.
 *
 * BẢN QUYỀN (13.7): chỉ lưu tiêu đề, tóm tắt ngắn LẤY TỪ CHÍNH RSS, và link về nguồn.
 * Không tải toàn văn bài báo, không lưu ảnh.
 */
class GDSFIN_News {

    const CRON_HOOK     = 'gdsfin_news_fetch';
    const CRON_SCHEDULE = 'gdsfin_two_hours';
    const HEALTH_OPTION = 'gdsfin_news_feed_health';

    /** Giữ tin trong bao nhiêu ngày (13.8). */
    const KEEP_DAYS = 30;

    /** Cùng tiêu đề trong bao nhiêu ngày thì coi là trùng (13.3). */
    const DUP_DAYS = 3;

    const SUMMARY_MAX = 600;

    /**
     * Ba nguồn mặc định — HẰNG SỐ, luôn có, user không xoá được (13.9).
     * Nhờ vậy màn không bao giờ rỗng chỉ vì user xoá hết nguồn của mình.
     */
    const DEFAULT_FEEDS = [
        ['name' => 'CafeF · Chứng khoán',   'url' => 'https://cafef.vn/thi-truong-chung-khoan.rss'],
        ['name' => 'Vietstock · Chứng khoán', 'url' => 'https://vietstock.vn/144/chung-khoan.rss'],
        ['name' => 'VnEconomy · Tài chính', 'url' => 'https://vneconomy.vn/tai-chinh.rss'],
    ];

    /* ===================== BẢNG ===================== */

    public static function create_tables() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        $p = $wpdb->prefix;

        $sql = "CREATE TABLE {$p}fin_news_items (
            id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            guid         VARCHAR(191)    NOT NULL,
            source       VARCHAR(60)     NOT NULL,
            title        VARCHAR(500)    NOT NULL,
            link         VARCHAR(700)    NOT NULL,
            published_at DATETIME        NULL,
            summary      VARCHAR(600)    NULL,
            title_key    CHAR(40)        NOT NULL,
            fetched_at   DATETIME        NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY uq_guid (guid),
            KEY idx_pub (published_at),
            KEY idx_title_key (title_key, published_at)
        ) $charset;

        CREATE TABLE {$p}fin_news_feeds (
            id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id    BIGINT UNSIGNED NOT NULL,
            name       VARCHAR(120)    NOT NULL,
            url        VARCHAR(500)    NOT NULL,
            is_active  TINYINT(1)      NOT NULL DEFAULT 1,
            created_at DATETIME        NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY uq_user_url (user_id, url),
            KEY idx_user (user_id, is_active)
        ) $charset;

        CREATE TABLE {$p}fin_news_flags (
            user_id  BIGINT UNSIGNED NOT NULL,
            news_id  BIGINT UNSIGNED NOT NULL,
            flag     VARCHAR(20)     NOT NULL,
            noted_at DATETIME        NOT NULL,
            PRIMARY KEY  (user_id, news_id)
        ) $charset;";

        dbDelta($sql);
    }

    private static function t_item()  { global $wpdb; return $wpdb->prefix . 'fin_news_items'; }
    private static function t_feed()  { global $wpdb; return $wpdb->prefix . 'fin_news_feeds'; }
    private static function t_flag()  { global $wpdb; return $wpdb->prefix . 'fin_news_flags'; }

    /* ===================== ROUTES ===================== */

    public static function register_routes() {
        $view   = fn() => current_user_can('fin_view');
        $manage = fn() => current_user_can('fin_manage');

        register_rest_route('fin/v1', '/fin/news', [
            'methods' => 'GET', 'callback' => [self::class, 'list_news'], 'permission_callback' => $view,
        ]);
        register_rest_route('fin/v1', '/fin/news/fetch', [
            'methods' => 'POST', 'callback' => [self::class, 'fetch_now'], 'permission_callback' => $manage,
        ]);
        register_rest_route('fin/v1', '/fin/news/(?P<id>\d+)/flag', [
            'methods' => 'PUT', 'callback' => [self::class, 'set_flag'], 'permission_callback' => $manage,
        ]);
        register_rest_route('fin/v1', '/fin/news-feeds', [
            ['methods' => 'GET',  'callback' => [self::class, 'list_feeds'],  'permission_callback' => $view],
            ['methods' => 'POST', 'callback' => [self::class, 'add_feed'],    'permission_callback' => $manage],
        ]);
        register_rest_route('fin/v1', '/fin/news-feeds/(?P<id>\d+)', [
            'methods' => 'DELETE', 'callback' => [self::class, 'delete_feed'], 'permission_callback' => $manage,
        ]);
    }

    /* ===================== CRON ===================== */

    /** WP không có sẵn mốc 2 giờ — phải tự thêm lịch. */
    public static function add_schedule(array $s): array {
        $s[self::CRON_SCHEDULE] = ['interval' => 2 * HOUR_IN_SECONDS, 'display' => 'Mỗi 2 giờ (GDS Finance tin tức)'];
        return $s;
    }

    public static function schedule_cron(): void {
        if (!wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_event(time() + 300, self::CRON_SCHEDULE, self::CRON_HOOK);
        }
    }

    public static function run_cron(): void {
        self::fetch_all();
    }

    /* ===================== NGUỒN ===================== */

    /**
     * Nguồn mặc định + nguồn của user đang bật.
     * Trùng URL với nguồn mặc định thì bỏ dòng của user, tránh nạp hai lần.
     */
    private static function feeds_for(int $uid): array {
        global $wpdb;
        $out  = [];
        $seen = [];
        foreach (self::DEFAULT_FEEDS as $f) {
            $out[] = ['name' => $f['name'], 'url' => $f['url'], 'is_default' => true, 'id' => null];
            $seen[self::norm_url($f['url'])] = true;
        }
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, name, url FROM " . self::t_feed() . "
              WHERE user_id = %d AND is_active = 1 ORDER BY id ASC", $uid
        ), ARRAY_A) ?: [];
        foreach ($rows as $r) {
            $k = self::norm_url($r['url']);
            if (isset($seen[$k])) continue;
            $seen[$k] = true;
            $out[] = ['name' => $r['name'], 'url' => $r['url'], 'is_default' => false, 'id' => (int) $r['id']];
        }
        return $out;
    }

    private static function norm_url(string $u): string {
        return rtrim(strtolower(preg_replace('#^https?://#', '', trim($u))), '/');
    }

    /* ===================== NẠP RSS ===================== */

    /**
     * Nạp một feed. Trả kết quả CHI TIẾT của riêng nó — nguồn chết phải thấy được,
     * không gộp thành một con số tổng (13.5).
     */
    private static function fetch_feed(array $feed): array {
        $res = [
            'name' => $feed['name'], 'url' => $feed['url'], 'ok' => false, 'http' => null,
            'items' => 0, 'inserted' => 0, 'skipped_guid' => 0, 'skipped_title' => 0, 'error' => null,
        ];

        $r = wp_remote_get($feed['url'], [
            'timeout'    => 20,
            'user-agent' => 'GDSFinance/1.0 (+WordPress)',
            'headers'    => ['Accept' => 'application/rss+xml, application/xml, text/xml'],
        ]);
        if (is_wp_error($r)) {
            $res['error'] = $r->get_error_message();
            return $res;
        }
        $res['http'] = (int) wp_remote_retrieve_response_code($r);
        $body = wp_remote_retrieve_body($r);
        if ($res['http'] !== 200 || $body === '') {
            $res['error'] = "HTTP {$res['http']}, thân phản hồi " . strlen($body) . " byte";
            return $res;
        }

        // libxml_use_internal_errors: feed lỗi cú pháp không được ném warning ra JSON
        $prev = libxml_use_internal_errors(true);
        $xml  = simplexml_load_string($body);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);

        if ($xml === false) {
            $res['error'] = 'Không phân tích được XML';
            return $res;
        }

        // RSS 2.0 (channel/item) và Atom (entry) — hai dạng khác nhau
        $items = [];
        if (isset($xml->channel->item)) {
            foreach ($xml->channel->item as $it) $items[] = $it;
        } elseif (isset($xml->entry)) {
            foreach ($xml->entry as $it) $items[] = $it;
        }
        $res['items'] = count($items);
        if (!$items) {
            $res['error'] = 'Feed đọc được nhưng không có item nào';
            return $res;
        }

        foreach ($items as $it) {
            $r2 = self::insert_item($feed['name'], $it);
            if ($r2 === 'inserted')      $res['inserted']++;
            elseif ($r2 === 'dup_guid')  $res['skipped_guid']++;
            elseif ($r2 === 'dup_title') $res['skipped_title']++;
        }
        $res['ok'] = true;
        return $res;
    }

    /** Chuẩn hoá tiêu đề để so trùng: bỏ dấu câu, gộp khoảng trắng, hạ chữ thường. */
    private static function title_key(string $title): string {
        $t = mb_strtolower(trim($title));
        $t = preg_replace('/[\p{P}\p{S}]+/u', ' ', $t);
        $t = preg_replace('/\s+/u', ' ', $t);
        return sha1(trim((string) $t));
    }

    /**
     * pubDate của ba nguồn KHÁC ĐỊNH DẠNG nhau (13.1): CafeF dùng năm 2 chữ số,
     * VnEconomy trả GMT, hai nguồn kia +0700. Quy tất cả về GMT+7.
     */
    private static function parse_date(string $raw): ?string {
        $raw = trim($raw);
        if ($raw === '') return null;
        $ts = strtotime($raw);
        if ($ts === false) return null;
        return (new DateTimeImmutable('@' . $ts))->setTimezone(GDSFIN_Util::tz())->format('Y-m-d H:i:s');
    }

    private static function insert_item(string $source, SimpleXMLElement $it): string {
        global $wpdb;

        $title = trim(html_entity_decode(strip_tags((string) $it->title), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if ($title === '') return 'skip';

        // Atom để link ở thuộc tính href
        $link = trim((string) $it->link);
        if ($link === '' && isset($it->link['href'])) $link = trim((string) $it->link['href']);

        $raw_guid = trim((string) ($it->guid ?? ''));
        if ($raw_guid === '') $raw_guid = trim((string) ($it->id ?? ''));
        if ($raw_guid === '') $raw_guid = $link !== '' ? $link : $source . '|' . $title;
        // UNIQUE index utf8mb4 không vượt được 191 ký tự (13.3)
        $guid = mb_strlen($raw_guid) > 191 ? 'sha1:' . sha1($raw_guid) : $raw_guid;

        $desc = (string) ($it->description ?? '');
        if ($desc === '') $desc = (string) ($it->summary ?? '');
        $summary = trim(html_entity_decode(strip_tags($desc), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        $summary = preg_replace('/\s+/u', ' ', $summary);
        if (mb_strlen($summary) > self::SUMMARY_MAX) {
            $summary = mb_substr($summary, 0, self::SUMMARY_MAX - 1) . '…';
        }

        $pub  = self::parse_date((string) ($it->pubDate ?? $it->published ?? $it->updated ?? ''));
        $tkey = self::title_key($title);
        $t    = self::t_item();

        // Trùng guid: cùng tin, cùng nguồn, nạp lại. Ca thường gặp nhất.
        if ($wpdb->get_var($wpdb->prepare("SELECT id FROM $t WHERE guid = %s", $guid))) {
            return 'dup_guid';
        }

        // Trùng tiêu đề trong DUP_DAYS: hai NGUỒN KHÁC NHAU đăng cùng tin.
        // Chỉ bắt được tiêu đề giống hệt sau chuẩn hoá — cố ý, xem 13.3.
        $since = (new DateTimeImmutable('now', GDSFIN_Util::tz()))
            ->modify('-' . self::DUP_DAYS . ' days')->format('Y-m-d H:i:s');
        $dup = $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM $t WHERE title_key = %s AND COALESCE(published_at, fetched_at) >= %s LIMIT 1",
            $tkey, $since
        ));
        if ($dup) return 'dup_title';

        $ok = $wpdb->insert($t, [
            'guid'         => $guid,
            'source'       => mb_substr($source, 0, 60),
            'title'        => mb_substr($title, 0, 500),
            'link'         => mb_substr($link, 0, 700),
            'published_at' => $pub,
            'summary'      => $summary !== '' ? $summary : null,
            'title_key'    => $tkey,
            'fetched_at'   => GDSFIN_Util::now_mysql(),
        ]);
        // Hai request đồng thời có thể chèn cùng guid: UNIQUE chặn, đếm là dup.
        return $ok ? 'inserted' : 'dup_guid';
    }

    /** Nạp mọi nguồn của user. Nguồn lỗi KHÔNG chặn nguồn còn lại (13.1). */
    public static function fetch_all(?int $uid = null): array {
        $uid = $uid ?: get_current_user_id();
        if (!$uid) {
            // Cron chạy không có user đăng nhập: dùng nguồn mặc định.
            $feeds = array_map(
                fn($f) => ['name' => $f['name'], 'url' => $f['url'], 'is_default' => true, 'id' => null],
                self::DEFAULT_FEEDS
            );
        } else {
            $feeds = self::feeds_for($uid);
        }

        $out = [];
        foreach ($feeds as $f) $out[] = self::fetch_feed($f);

        self::record_health($out);
        $purged = self::purge_old();

        return ['as_of' => GDSFIN_Util::now_mysql(), 'feeds' => $out, 'purged' => $purged];
    }

    private static function record_health(array $results): void {
        $h = get_option(self::HEALTH_OPTION, []);
        if (!is_array($h)) $h = [];
        $now = GDSFIN_Util::now_mysql();
        foreach ($results as $r) {
            $k = self::norm_url($r['url']);
            $e = $h[$k] ?? ['last_ok_at' => null, 'last_error_at' => null, 'last_error' => null];
            if ($r['ok']) {
                $e['last_ok_at'] = $now;
                $e['last_items'] = $r['items'];
            } else {
                $e['last_error_at'] = $now;
                $e['last_error']    = $r['error'];
            }
            $h[$k] = $e;
        }
        update_option(self::HEALTH_OPTION, $h, false);
    }

    /** Xoá tin cũ hơn KEEP_DAYS, và cờ trỏ tới tin đã xoá (13.8). */
    public static function purge_old(): int {
        global $wpdb;
        $cut = (new DateTimeImmutable('now', GDSFIN_Util::tz()))
            ->modify('-' . self::KEEP_DAYS . ' days')->format('Y-m-d H:i:s');
        $t  = self::t_item();
        $tf = self::t_flag();

        $n = (int) $wpdb->query($wpdb->prepare(
            "DELETE FROM $t WHERE COALESCE(published_at, fetched_at) < %s", $cut
        ));
        // Dọn cờ mồ côi — bảng cờ không có khoá ngoại nên phải tự dọn.
        $wpdb->query("DELETE f FROM $tf f LEFT JOIN $t i ON i.id = f.news_id WHERE i.id IS NULL");
        return $n;
    }

    /* ===================== KHỚP MÃ ===================== */

    /**
     * Mã đang nắm, lấy từ ENGINE A (13.4) — không tự đếm lại từ sổ lệnh.
     * @return string[] mã đã viết hoa
     */
    public static function held_syms(int $uid): array {
        $sum = GDSFIN_Stock::compute($uid);
        $out = [];
        foreach ($sum['by_sym'] as $r) {
            if (bccomp((string) $r['shares'], '0', 0) > 0) $out[] = strtoupper($r['sym']);
        }
        return $out;
    }

    /**
     * Mã xuất hiện trong tiêu đề/tóm tắt. Khớp chuỗi đơn giản, PHÂN BIỆT HOA THƯỜNG.
     *
     * Không hạ chữ thường là quyết định có chủ ý: mã VN luôn viết hoa trong bài báo,
     * nên giữ nguyên chữ giúp từ tiếng Anh viết thường ("gas") không khớp mã ("GAS").
     *
     * Biên phải là \p{L}\p{N} (MỌI chữ và số, kể cả chữ thường và chữ có dấu), KHÔNG
     * phải [A-Z0-9]. Bản đầu tôi dùng [A-Z0-9] và nó cho "HPGas" khớp mã "HPG" — chữ
     * thường phía sau không nằm trong lớp nên lookahead lọt. Đúng loại gán nhầm mà mục
     * 13.4 muốn tránh.
     */
    public static function match_syms(string $text, array $syms): array {
        $hit = [];
        foreach ($syms as $s) {
            $q = preg_quote($s, '/');
            if (preg_match('/(?<![\p{L}\p{N}])' . $q . '(?![\p{L}\p{N}])/u', $text)) $hit[] = $s;
        }
        return $hit;
    }

    /* ===================== ENDPOINT ===================== */

    public static function list_news(WP_REST_Request $req) {
        global $wpdb;
        $uid   = get_current_user_id();
        $scope = $req->get_param('scope') === 'portfolio' ? 'portfolio' : 'all';
        $limit = (int) $req->get_param('limit');
        if ($limit <= 0 || $limit > 300) $limit = 150;

        $t  = self::t_item();
        $tf = self::t_flag();

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT i.id, i.source, i.title, i.link, i.published_at, i.summary, i.fetched_at,
                    f.flag
               FROM $t i
               LEFT JOIN $tf f ON f.news_id = i.id AND f.user_id = %d
              ORDER BY COALESCE(i.published_at, i.fetched_at) DESC, i.id DESC
              LIMIT %d", $uid, $limit
        ), ARRAY_A) ?: [];

        $held  = self::held_syms($uid);
        $items = [];
        $matched = 0;
        foreach ($rows as $r) {
            $syms = self::match_syms($r['title'] . ' ' . (string) $r['summary'], $held);
            if ($syms) $matched++;
            if ($scope === 'portfolio' && !$syms) continue;
            $items[] = [
                'id'           => (string) $r['id'],
                'source'       => $r['source'],
                'title'        => $r['title'],
                'link'         => $r['link'],
                'published_at' => $r['published_at'],
                'fetched_at'   => $r['fetched_at'],
                'summary'      => $r['summary'],
                'syms'         => $syms,
                'flag'         => $r['flag'] ?: null,
            ];
        }

        $bounds = $wpdb->get_row(
            "SELECT MIN(COALESCE(published_at, fetched_at)) AS f,
                    MAX(COALESCE(published_at, fetched_at)) AS t,
                    COUNT(*) AS n FROM $t", ARRAY_A
        );

        return rest_ensure_response([
            'scope'    => $scope,
            'items'    => $items,
            'held'     => $held,
            'coverage' => [
                'total'    => (int) ($bounds['n'] ?? 0),
                'shown'    => count($rows),
                'matched'  => $matched,
                'from'     => $bounds['f'] ?? null,
                'to'       => $bounds['t'] ?? null,
            ],
            'feeds_health' => self::health_out($uid),
            'next_cron'    => wp_next_scheduled(self::CRON_HOOK)
                ? (new DateTimeImmutable('@' . wp_next_scheduled(self::CRON_HOOK)))
                    ->setTimezone(GDSFIN_Util::tz())->format('Y-m-d H:i:s')
                : null,
        ]);
    }

    private static function health_out(int $uid): array {
        $h   = get_option(self::HEALTH_OPTION, []);
        if (!is_array($h)) $h = [];
        $out = [];
        foreach (self::feeds_for($uid) as $f) {
            $e = $h[self::norm_url($f['url'])] ?? [];
            $out[] = [
                'name'          => $f['name'],
                'url'           => $f['url'],
                'is_default'    => $f['is_default'],
                'last_ok_at'    => $e['last_ok_at'] ?? null,
                'last_error_at' => $e['last_error_at'] ?? null,
                'last_error'    => $e['last_error'] ?? null,
                'last_items'    => $e['last_items'] ?? null,
            ];
        }
        return $out;
    }

    public static function fetch_now(WP_REST_Request $req) {
        return rest_ensure_response(self::fetch_all(get_current_user_id()));
    }

    public static function set_flag(WP_REST_Request $req) {
        global $wpdb;
        $uid  = get_current_user_id();
        $id   = absint($req['id']);
        $b    = (array) $req->get_json_params();
        $flag = sanitize_text_field((string) ($b['flag'] ?? ''));

        if (!in_array($flag, ['save', 'watch', ''], true)) {
            return new WP_Error('bad_flag', "flag phải là 'save', 'watch' hoặc rỗng", ['status' => 400]);
        }
        if (!$wpdb->get_var($wpdb->prepare("SELECT id FROM " . self::t_item() . " WHERE id = %d", $id))) {
            return new WP_Error('not_found', 'Không tìm thấy tin', ['status' => 404]);
        }

        $tf = self::t_flag();
        if ($flag === '') {
            $wpdb->query($wpdb->prepare("DELETE FROM $tf WHERE user_id = %d AND news_id = %d", $uid, $id));
            return rest_ensure_response(['flag' => null]);
        }
        $wpdb->query($wpdb->prepare(
            "INSERT INTO $tf (user_id, news_id, flag, noted_at) VALUES (%d, %d, %s, %s)
             ON DUPLICATE KEY UPDATE flag = VALUES(flag), noted_at = VALUES(noted_at)",
            $uid, $id, $flag, GDSFIN_Util::now_mysql()
        ));
        return rest_ensure_response(['flag' => $flag]);
    }

    public static function list_feeds(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $out = [];
        foreach (self::DEFAULT_FEEDS as $f) {
            $out[] = ['id' => null, 'name' => $f['name'], 'url' => $f['url'],
                      'is_active' => true, 'is_default' => true];
        }
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, name, url, is_active FROM " . self::t_feed() . "
              WHERE user_id = %d ORDER BY id ASC", $uid
        ), ARRAY_A) ?: [];
        foreach ($rows as $r) {
            $out[] = ['id' => (string) $r['id'], 'name' => $r['name'], 'url' => $r['url'],
                      'is_active' => (bool) (int) $r['is_active'], 'is_default' => false];
        }
        return rest_ensure_response($out);
    }

    public static function add_feed(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $b   = (array) $req->get_json_params();

        $name = trim(sanitize_text_field((string) ($b['name'] ?? '')));
        $url  = trim((string) ($b['url'] ?? ''));

        // esc_url_raw + wp_http_validate_url: chặn URL rác và địa chỉ nội bộ (SSRF)
        $url = esc_url_raw($url, ['http', 'https']);
        if ($url === '' || !wp_http_validate_url($url)) {
            return new WP_Error('bad_url', 'URL không hợp lệ (chỉ nhận http/https, không nhận địa chỉ nội bộ)', ['status' => 400]);
        }
        if ($name === '') $name = wp_parse_url($url, PHP_URL_HOST) ?: 'Nguồn mới';

        foreach (self::DEFAULT_FEEDS as $f) {
            if (self::norm_url($f['url']) === self::norm_url($url)) {
                return new WP_Error('dup_default', 'Nguồn này đã có trong danh sách mặc định', ['status' => 400]);
            }
        }

        $t = self::t_feed();
        if ($wpdb->get_var($wpdb->prepare("SELECT id FROM $t WHERE user_id = %d AND url = %s", $uid, $url))) {
            return new WP_Error('dup_feed', 'Bạn đã thêm nguồn này rồi', ['status' => 400]);
        }

        $wpdb->insert($t, [
            'user_id'    => $uid,
            'name'       => mb_substr($name, 0, 120),
            'url'        => mb_substr($url, 0, 500),
            'is_active'  => 1,
            'created_at' => GDSFIN_Util::now_mysql(),
        ]);
        $id = (int) $wpdb->insert_id;

        // Thử ngay để user biết nguồn dùng được hay không, thay vì chờ tới đợt cron sau
        $probe = self::fetch_feed(['name' => $name, 'url' => $url]);
        self::record_health([$probe]);

        return rest_ensure_response(['id' => (string) $id, 'probe' => $probe]);
    }

    public static function delete_feed(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $id  = absint($req['id']);
        // Lọc theo user_id: nguồn của người khác trả 404, không 403 (mục 0.2)
        $n = $wpdb->query($wpdb->prepare(
            "DELETE FROM " . self::t_feed() . " WHERE id = %d AND user_id = %d", $id, $uid
        ));
        if (!$n) return new WP_Error('not_found', 'Không tìm thấy nguồn', ['status' => 404]);
        return rest_ensure_response(['deleted' => (int) $n]);
    }
}
