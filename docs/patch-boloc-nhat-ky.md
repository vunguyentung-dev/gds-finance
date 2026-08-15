# Patch backend — thêm bộ lọc Ngày và Cảm nhận thị trường cho Nhật ký

Bạn tự áp. Chỉ sửa **1 file**: `backend/includes/class-fin-journal.php`, hai hàm
`index()` và `years()`.

## 0. Tóm tắt

| Việc | Cần? |
|---|---|
| Nâng `GDSFIN_DB_VERSION` | **KHÔNG** — không thêm cột, không thêm bảng, không đổi chỉ mục |
| Nâng `GDSFIN_VERSION` | **CÓ** — `app.js` đổi, không bump thì trình duyệt giữ bundle cũ |
| Migrate dữ liệu | KHÔNG |

Cột `mood` đã có sẵn trong bảng từ đầu (`VARCHAR(10)`), và hằng `self::MOODS` đã
liệt kê đủ 5 giá trị. Patch này chỉ **dùng** những thứ đã có.

## 1. `index()` — thêm hai điều kiện lọc

Trong khối dựng `$where`, thêm **ngay sau** dòng lọc `flag`:

```php
        // Ngày chỉ có nghĩa khi đã chốt CẢ năm lẫn tháng. "Ngày 15" mà không nói
        // tháng nào thì khớp ngày 15 của mọi tháng mọi năm — gần như chắc chắn không
        // phải ý người dùng, nên bỏ qua thay vì lọc ra một tập vô nghĩa.
        $day = absint($req->get_param('day'));
        if ($day >= 1 && $day <= 31 && $y && $m) {
            $where .= " AND DAY(noted_at) = %d";
            $args[] = $day;
        }

        $mood = (string) $req->get_param('mood');
        if ($mood !== '' && in_array($mood, self::MOODS, true)) {
            $where .= " AND mood = %s";
            $args[] = $mood;
        }
```

Không cần sửa gì thêm. `$where` và `$args` đã được dùng chung cho cả `COUNT(*)` lẫn
`SELECT`, nên `X-WP-Total` tự động phản ánh số kết quả **sau khi lọc**, và phân trang
vẫn áp **sau** bộ lọc — đúng như đợt trước.

Các bộ lọc nối bằng `AND` vì chúng cùng bồi vào một chuỗi `$where`.

**`$y` và `$m` chắc chắn tồn tại** ở điểm này: hai dòng phía trên gán chúng ngay
trong điều kiện `if ($y = absint(...))`, phép gán luôn chạy dù `if` đúng hay sai.
Không cần khai báo trước.

**`mood` sai giá trị thì BỎ QUA, không báo lỗi** — giống hệt cách `flag` đang xử lý.
Giữ nhất quán: một tham số lọc rác không nên làm hỏng cả yêu cầu.

## 2. `years()` — trả thêm tháng có dữ liệu theo từng năm

Thay toàn bộ hàm:

```php
    public static function years(WP_REST_Request $req) {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT DISTINCT YEAR(noted_at) y, MONTH(noted_at) m
               FROM " . self::table() . "
              WHERE user_id = %d AND status = 'posted'
              ORDER BY y DESC, m DESC",
            get_current_user_id()
        ), ARRAY_A) ?: [];

        $years  = [];
        $months = [];
        foreach ($rows as $r) {
            $y = (int) $r['y'];
            if (!in_array($y, $years, true)) { $years[] = $y; }
            $months[$y][] = (int) $r['m'];
        }

        // (object) để bảng rỗng ra {} chứ không ra [] — client đọc theo khoá năm,
        // nhận mảng rỗng thì phải viết thêm nhánh xử lý riêng cho đúng một ca.
        return rest_ensure_response([
            'years'  => $years,
            'months' => (object) $months,
        ]);
    }
```

Khoá `years` **giữ nguyên hình dạng cũ**, nên client cũ không hỏng. `months` là khoá
mới, dạng `{"2026":[8,7,5],"2025":[12,11]}` — tháng giảm dần trong mỗi năm.

Dùng để dropdown Tháng chỉ hiện tháng **thực sự có ghi chép**, thay vì luôn đủ 12
tháng trong đó phần lớn chọn vào là ra rỗng.

## 3. Về chỉ mục

`DAY(noted_at)` gọi hàm lên cột nên **không dùng được chỉ mục** — y hệt `YEAR()` và
`MONTH()` mà mã hiện tại đã dùng từ đầu. Với bảng nhật ký cá nhân (vài nghìn dòng là
cùng) thì không đáng đổi thiết kế. Nếu sau này cần, cách đúng là lọc theo khoảng
`noted_at >= ? AND noted_at < ?` để tận dụng `idx_user_noted`, chứ không phải thêm
cột hay thêm chỉ mục trên biểu thức.

## 4. Soát sau khi áp

```bash
# lọc cảm nhận: tổng phải là tổng ĐÃ LỌC
curl -si '.../fin/journal?mood=fear' -H 'X-WP-Nonce: ...' | grep -i x-wp-total

# ngày không kèm năm+tháng thì phải BỊ BỎ QUA (kết quả y như không truyền day)
curl -s '.../fin/journal?day=15'          | jq 'length'
curl -s '.../fin/journal'                 | jq 'length'   # hai số phải bằng nhau

# ngày có đủ năm+tháng thì phải có tác dụng
curl -s '.../fin/journal?year=2026&month=8&day=15' | jq 'length'

# months trong years
curl -s '.../fin/journal/years' | jq '.months'
```

Áp xong bảo tôi, tôi chạy bảng đối chiếu kỳ vọng vs thực tế trên bảng thật.
