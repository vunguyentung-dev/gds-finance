# Patch backend — loại giao dịch "Đầu tư tài chính"

Bạn tự áp phần này. Chỉ sửa **2 file**: `backend/includes/class-fin-personal.php`
và `backend/gds-finance.php`.

## 0. Tóm tắt phải đọc trước

| Việc | Bắt buộc? |
|---|---|
| Nới `entry_type` từ `VARCHAR(3)` lên `VARCHAR(10)` | **CÓ — nếu bỏ là hỏng dữ liệu ngầm** |
| Nâng `GDSFIN_DB_VERSION` 1.8.0 → **1.9.0** | **CÓ** — không nâng thì `dbDelta` không chạy, cột không được nới |
| Nâng `GDSFIN_VERSION` 1.9.1 → **1.10.0** | **CÓ** — không nâng thì trình duyệt vẫn dùng `app.js` cache cũ |
| Chặn `summary()` không đếm `inv_*` | **CÓ** — bỏ là `inv_in`/`inv_out` bị tính thành **CHI** |
| Endpoint mới `GET fin/invested` | CÓ |
| Migrate dữ liệu cũ | **KHÔNG** — `in`/`out` giữ nguyên |

### Vì sao cột `VARCHAR(3)` là việc nguy hiểm nhất

Cột hiện tại chỉ chứa 3 ký tự, đủ cho `in`/`out`. `inv_in` dài 6, `inv_out` dài 7.
MySQL ở chế độ **không strict** sẽ **cắt âm thầm cả hai thành `inv`** — không báo lỗi,
không cảnh báo. Hậu quả: hai chiều nộp và rút biến thành **cùng một giá trị**, vốn ròng
tính ra sai và không có cách nào phục hồi chiều đã mất. Nới cột **trước khi** ghi bản
ghi đầu tiên.

Sau khi áp patch, chạy đúng câu này để soát — bắt buộc:

```sql
SHOW COLUMNS FROM wp_fin_personal LIKE 'entry_type';
-- Type phải là varchar(10). Còn varchar(3) thì DỪNG, đừng nhập gì.
```

`dbDelta` sẽ tự sinh `ALTER TABLE`. Nếu vì lý do gì nó không áp, chạy tay:

```sql
ALTER TABLE wp_fin_personal MODIFY entry_type VARCHAR(10) NOT NULL;
```

## 1. `backend/gds-finance.php`

Hai hằng số ở đầu file:

```php
define('GDSFIN_VERSION', '1.10.0');
define('GDSFIN_DB_VERSION', '1.9.0');
```

Không cần sửa gì khác — `GDSFIN_Personal::create_table()` đã nằm trong khối
`plugins_loaded`, nên `dbDelta` sẽ tự chạy khi `gdsfin_db_version` khác hằng số.

## 2. `backend/includes/class-fin-personal.php`

### 2.1 Thêm hằng số, ngay dưới `const CATS`

`CATS` **giữ nguyên** — `fin/categories` không đổi output, frontend không cần
danh mục cho loại đầu tư (form chỉ có Nộp/Rút).

```php
    /**
     * Chuyển tiền giữa hai túi của chính user — KHÔNG phải thu/chi sinh hoạt.
     * cat do backend đóng dấu, client không gửi: form chỉ có Nộp/Rút.
     */
    const INV_CATS = [
        'inv_in'  => 'Nộp vào TK chứng khoán',
        'inv_out' => 'Rút khỏi TK chứng khoán',
    ];

    const S = GDSFIN_Util::S;
```

### 2.2 Đăng ký endpoint mới, trong `register_routes()`

Thêm sau khối `/fin/summary`:

```php
        // Vốn ròng đã bỏ vào thị trường — CỘNG DỒN TOÀN BỘ, không lọc năm/tháng
        register_rest_route('fin/v1', '/fin/invested', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'invested'],
            'permission_callback' => $can_view,
        ]);
```

### 2.3 Nới cột trong `create_table()`

Đổi **đúng một dòng**:

```php
            entry_type VARCHAR(10) NOT NULL,
```

### 2.4 Sửa `create_entry()`

Thay khối từ `$type = ...` đến `$date = ...` bằng:

```php
        $type = (string)($b['entry_type'] ?? '');
        if (!in_array($type, ['in', 'out', 'inv_in', 'inv_out'], true)) {
            return new WP_Error('bad_type', 'Loại khoản không hợp lệ', ['status' => 400]);
        }

        if (isset(self::INV_CATS[$type])) {
            // cat của khoản đầu tư do backend đóng, bỏ qua giá trị client gửi
            $cat = self::INV_CATS[$type];
        } else {
            $cat = sanitize_text_field($b['cat'] ?? '');
            if (!in_array($cat, self::CATS[$type], true)) {
                return new WP_Error('bad_cat', 'Danh mục không hợp lệ', ['status' => 400]);
            }
        }

        $amount = (float)($b['amount'] ?? 0);   // đã theo ĐỒNG
        if ($amount <= 0) {
            return new WP_Error('bad_amount', 'Số tiền phải lớn hơn 0', ['status' => 400]);
        }
        $amount_s = number_format($amount, 4, '.', '');

        // Vốn ròng không được âm: không rút quá số đã nộp.
        // So sánh bằng bccomp trên chuỗi, không so bằng float.
        if ($type === 'inv_out') {
            $net = self::invested_totals($uid)['net'];
            if (bccomp($amount_s, $net, 4) > 0) {
                return new WP_Error('inv_overdraw', sprintf(
                    'Không rút được %s ₫: vốn ròng hiện có %s ₫.',
                    number_format((float)$amount_s, 0, ',', '.'),
                    number_format((float)$net, 0, ',', '.')
                ), ['status' => 400, 'net' => GDSFIN_Util::money_out($net)]);
            }
        }

        $date = sanitize_text_field($b['entry_date'] ?? GDSFIN_Util::today());
```

rồi trong `$wpdb->insert(...)` đổi dòng `amount` thành:

```php
            'amount'     => $amount_s,
```

> Đường tính tiền của `in`/`out` **không đổi một bước nào**: vẫn `(float)` rồi
> `number_format($amount, 4, '.', '')`. Chỉ đặt tên biến trung gian để dùng lại cho
> phép so sánh. Số của `fin/entries` giữ nguyên byte-for-byte.

### 2.5 Sửa `delete_entry()` — chặn xóa làm vốn ròng âm

Thay toàn bộ thân hàm:

```php
    public static function delete_entry(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $id  = absint($req['id']);
        $t   = self::table();

        // chỉ đọc/xóa bản ghi của chính mình
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT entry_type, amount FROM $t WHERE id = %d AND user_id = %d",
            $id, $uid
        ), ARRAY_A);
        if (!$row) {
            return rest_ensure_response(['deleted' => 0]);
        }

        // Xóa một khoản NỘP có thể đẩy vốn ròng xuống âm. Chặn, giữ đúng bất biến —
        // nếu không thì cấm rút quá số nộp ở create_entry sẽ đi vòng qua đây được.
        if ($row['entry_type'] === 'inv_in') {
            $net = self::invested_totals($uid)['net'];
            if (bccomp((string)$row['amount'], $net, 4) > 0) {
                return new WP_Error('inv_underflow',
                    'Xóa khoản nộp này sẽ làm vốn ròng âm. Hãy xóa khoản rút liên quan trước.',
                    ['status' => 409]);
            }
        }

        $deleted = $wpdb->delete($t, ['id' => $id, 'user_id' => $uid]);
        return rest_ensure_response(['deleted' => (int)$deleted]);
    }
```

### 2.6 Sửa `summary()` — ĐÂY LÀ DÒNG QUAN TRỌNG NHẤT

Trong vòng `foreach ($rows as $r)`, thêm **ngay sau** dòng lọc năm:

```php
        foreach ($rows as $r) {
            if ((int)$r['y'] !== $curYear) continue;
            // 'inv_in'/'inv_out' là chuyển tiền giữa hai túi của chính user.
            // KHÔNG vào Thu/Chi tháng, Thu/Chi năm, biểu đồ 12 tháng, chi tiêu theo
            // loại, dòng tiền ròng năm. Nhánh else phía dưới bắt MỌI thứ khác 'in',
            // nên thiếu dòng này thì nạp 1 tỷ sẽ hiện thành tháng chi 1 tỷ.
            if ($r['entry_type'] !== 'in' && $r['entry_type'] !== 'out') continue;
            ...giữ nguyên phần còn lại...
```

`$years` **để nguyên** (vẫn dựng từ mọi bản ghi). Năm chỉ có khoản đầu tư vẫn hiện
trong ô chọn năm — đúng, vì năm đó có dữ liệu; các số thu/chi của năm đó bằng 0.

### 2.7 Thêm hai hàm mới, cuối class

```php
    /**
     * Tổng đã nộp / đã rút / vốn ròng, CỘNG DỒN TOÀN BỘ LỊCH SỬ.
     * Không lọc năm, không lọc tháng — đây là số dư luỹ kế, không phải báo cáo kỳ.
     * SUM() trên DECIMAL(20,4) trả chuỗi thập phân chính xác; trừ bằng bcsub.
     */
    public static function invested_totals(int $uid): array {
        global $wpdb;
        $t = self::table();
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT entry_type, SUM(amount) AS total
               FROM $t
              WHERE user_id = %d AND entry_type IN ('inv_in', 'inv_out')
              GROUP BY entry_type",
            $uid
        ), ARRAY_A);

        $in = '0'; $out = '0';
        foreach ($rows as $r) {
            if ($r['entry_type'] === 'inv_in')  { $in  = (string)$r['total']; }
            if ($r['entry_type'] === 'inv_out') { $out = (string)$r['total']; }
        }
        return ['in' => $in, 'out' => $out, 'net' => bcsub($in, $out, self::S)];
    }

    public static function invested(WP_REST_Request $req) {
        $t = self::invested_totals(get_current_user_id());
        return rest_ensure_response([
            'in'  => GDSFIN_Util::money_out($t['in']),
            'out' => GDSFIN_Util::money_out($t['out']),
            'net' => GDSFIN_Util::money_out($t['net']),
        ]);
    }
```

## 3. Một điểm đặt tên dễ nhầm — bạn quyết

`CATS['out']` **đã có sẵn** một danh mục chi tên là **`'Đầu tư'`**. Từ giờ trong app
có hai thứ khác nhau cùng mang chữ "đầu tư":

| | `entry_type` | Vào Chi tháng/năm? | Vào vốn ròng? |
|---|---|---|---|
| Danh mục chi cũ `'Đầu tư'` | `out` | **CÓ** | không |
| Loại mới Nộp vào | `inv_in` | không | **CÓ** |

Bạn yêu cầu không migrate, nên các bản ghi cũ `out`/`'Đầu tư'` **vẫn tính là chi** —
đúng như đã chốt. Frontend đã tránh nhầm lẫn bằng cách gắn nhãn khoản mới là
"Nộp vào TK" / "Rút khỏi TK", không dùng chữ "Đầu tư" trong sổ giao dịch.

Nếu muốn dứt điểm, **bỏ `'Đầu tư'` khỏi `CATS['out']`** để không nhập mới được nữa
trong khi bản ghi cũ vẫn nguyên. Việc này thay đổi output của `fin/categories`, nên
tôi không tự làm — bạn quyết.

## 4. Soát sau khi áp

```bash
# 1. cột đã nới chưa
docker compose -f infra/docker/compose.yml exec -T db \
  mariadb -uwp -pdevpass wordpress -e "SHOW COLUMNS FROM wp_fin_personal LIKE 'entry_type'"

# 2. dbDelta đã chạy chưa
docker compose -f infra/docker/compose.yml exec -T db \
  mariadb -uwp -pdevpass wordpress -e \
  "SELECT option_value FROM wp_options WHERE option_name='gdsfin_db_version'"
```

Cột `varchar(10)` và version `1.9.0` thì xong. Bảo tôi, tôi chạy bảng đối chiếu
kỳ vọng vs thực tế.
