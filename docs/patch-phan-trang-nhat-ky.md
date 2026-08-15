# Patch backend — phân trang cho `GET fin/journal`

> **ĐÃ ÁP XONG** ngày 2026-08-15, nhánh `feature/phan-trang-nhat-ky-20260815`.
> Verify trên class thật: 46 OK · 0 LỆCH, với 137 ghi chép test tự tạo rồi dọn sạch.
> `GDSFIN_VERSION` lên 1.12.0, `GDSFIN_DB_VERSION` giữ 1.9.0. Giữ file làm hồ sơ.

Chỉ sửa **1 file**: `backend/includes/class-fin-journal.php`, và chỉ **một
hàm**: `index()`.

## 0. Tóm tắt

| Việc | Cần? |
|---|---|
| Nâng `GDSFIN_DB_VERSION` | **KHÔNG** — không đổi cấu trúc bảng nào |
| Nâng `GDSFIN_VERSION` | **CÓ** — `app.js` đổi, không bump thì trình duyệt giữ bundle cũ |
| Thêm cột / chỉ mục | KHÔNG |
| Sửa `store()` / `destroy()` / `years()` | KHÔNG |

Chỉ mục `idx_user_noted (user_id, status, noted_at)` đã có sẵn và đúng thứ tự cần
cho `ORDER BY noted_at DESC` — không cần thêm gì.

## 1. Một thay đổi hành vi phải biết trước

Hiện `GET fin/journal` không có tham số trang thì trả **tối đa 1000** bản ghi. Sau
patch, gọi không tham số sẽ trả **20** bản ghi đầu — vì `per_page` mặc định là 20
theo đúng yêu cầu.

Đây là **đổi hành vi có chủ ý**, không phải hồi quy. Frontend đã sửa kèm để đọc
`X-WP-Total` và tự nối thêm trang. Nhưng nếu bạn có script hay công cụ nào khác đang
gọi thẳng endpoint này và trông đợi lấy hết, nó sẽ chỉ nhận được 20 dòng.

`LIMIT 1000` cũ bị bỏ hẳn. Trước đây nó là cái chặn thô để bảng không trả về vô hạn;
giờ phân trang lo việc đó, và `per_page` bị kẹp ở 50 nên không có đường lấy quá 50
dòng một lượt.

Số liệu và thứ tự **không đổi**: vẫn `noted_at DESC, id DESC`, vẫn lọc
`status = 'posted'`, các bộ lọc năm/tháng/cờ giữ nguyên và **áp trước** khi phân
trang.

## 2. Thay toàn bộ hàm `index()`

```php
    /** Số bản ghi mỗi trang khi client không nói gì, và trần cứng. */
    const PER_PAGE_DEFAULT = 20;
    const PER_PAGE_MAX     = 50;

    public static function index(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $t   = self::table();

        // ----- bộ lọc: dựng MỘT LẦN, dùng cho cả đếm lẫn lấy dữ liệu -----
        // Đếm và lấy phải cùng điều kiện, nếu không thì X-WP-Total nói một đằng,
        // dữ liệu trả về một nẻo, và trang cuối sẽ rỗng mà client vẫn tưởng còn.
        $where = "WHERE user_id = %d AND status = 'posted'";
        $args  = [$uid];
        if ($y = absint($req->get_param('year')))  { $where .= " AND YEAR(noted_at) = %d";  $args[] = $y; }
        if ($m = absint($req->get_param('month'))) { $where .= " AND MONTH(noted_at) = %d"; $args[] = $m; }
        $flag = (string) $req->get_param('flag');
        if ($flag !== '' && in_array($flag, self::FLAGS, true)) { $where .= " AND flag = %s"; $args[] = $flag; }

        // ----- phân trang: ép về số nguyên dương, kẹp trần -----
        // (int) chứ KHÔNG phải absint(): absint() lấy TRỊ TUYỆT ĐỐI, nên page=-5 sẽ
        // thành trang 5 và per_page=-3 thành 3 dòng — âm thầm sai chứ không báo lỗi.
        // (int) cho -5 -> -5, 'abc' -> 0, '2.9' -> 2; tất cả rơi đúng vào nhánh dưới.
        $page = (int) $req->get_param('page');
        if ($page < 1) $page = 1;

        $per = $req->get_param('per_page');
        $per = ($per === null || $per === '') ? self::PER_PAGE_DEFAULT : (int) $per;
        if ($per < 1)                    $per = self::PER_PAGE_DEFAULT;
        if ($per > self::PER_PAGE_MAX)   $per = self::PER_PAGE_MAX;

        // ----- tổng số bản ghi SAU khi lọc -----
        $total = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM $t $where", ...$args));
        $pages = $total > 0 ? (int) ceil($total / $per) : 0;

        // ----- lấy đúng một trang -----
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, mood, flag, vnindex, body, noted_at
               FROM $t $where
              ORDER BY noted_at DESC, id DESC
              LIMIT %d OFFSET %d",
            ...array_merge($args, [$per, ($page - 1) * $per])
        ), ARRAY_A) ?: [];

        $data = array_map(fn($r) => [
            'id'       => (string) $r['id'],
            'mood'     => $r['mood'],
            'flag'     => $r['flag'],
            'vnindex'  => $r['vnindex'],
            'body'     => $r['body'],
            'noted_at' => $r['noted_at'],
        ], $rows);

        // Header chuẩn WordPress, giống cách wp/v2 trả về.
        $res = rest_ensure_response($data);
        $res->header('X-WP-Total', (string) $total);
        $res->header('X-WP-TotalPages', (string) $pages);
        return $res;
    }
```

## 3. Ba chỗ dễ sai

**Đếm phải dùng đúng bộ lọc của phần lấy dữ liệu.** Vì thế `$where` và `$args` được
dựng một lần rồi dùng cho cả hai câu. Viết hai câu riêng rồi sửa một bên quên bên kia
là lỗi kinh điển: `X-WP-Total` báo 137 trong khi bộ lọc chỉ có 12 dòng.

**`LIMIT %d OFFSET %d` phải đi qua `prepare`.** Nối chuỗi trực tiếp `LIMIT $per` là
mở đường SQL injection, kể cả khi bạn nghĩ `absint()` đã chặn — đừng tạo tiền lệ.
`$wpdb->prepare` xử lý `%d` cho LIMIT/OFFSET bình thường.

**`$pages` bằng 0 khi không có bản ghi nào**, không phải 1. Bộ lọc không khớp gì thì
`X-WP-Total: 0` và `X-WP-TotalPages: 0`. Client hiểu là hết, không hiện nút Tải thêm.

**Đừng dùng `absint()` cho `page`/`per_page`.** Bản nháp đầu của patch này dùng
`absint()` và phép kiểm bắt được: `absint(-5) === 5`, không phải 0 — nó lấy trị tuyệt
đối. Hậu quả là `page=-5` nhảy sang trang 5 và `per_page=-3` trả về 3 dòng, sai âm
thầm chứ không báo gì. `(int)` mới rơi đúng vào nhánh kẹp bên dưới.

`absint()` ở hai dòng lọc `year`/`month` thì **giữ nguyên** — đó là mã cũ, và năm âm
hay tháng âm không có nghĩa gì để mà xử lý riêng.

## 4. Soát sau khi áp

```bash
# 20 dòng, tổng thật, số trang
curl -si 'http://localhost:8080/wp-json/fin/v1/fin/journal' -H 'X-WP-Nonce: ...' \
  | grep -i 'x-wp-total'

# per_page vượt trần phải bị kẹp về 50, KHÔNG phải 999
curl -s '.../fin/journal?per_page=999' | jq 'length'      # -> 50

# tham số rác không được làm vỡ
curl -s '.../fin/journal?page=abc&per_page=-5' | jq 'length'   # -> 20 (mặc định)
```

Áp xong bảo tôi, tôi chạy bảng đối chiếu kỳ vọng vs thực tế trên dữ liệu thật.
