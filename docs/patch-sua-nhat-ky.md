# Patch backend — sửa ghi chép nhật ký đã lưu

Sửa **1 file**: `backend/includes/class-fin-journal.php`, cộng hai hằng version.

## 0. Tóm tắt

| Việc | Cần? |
|---|---|
| Nâng `GDSFIN_DB_VERSION` 1.10.0 → **1.11.0** | **CÓ** — thêm cột `updated_at` |
| Nâng `GDSFIN_VERSION` → 1.16.0 | CÓ |
| Sửa gì cho phần ẢNH | **KHÔNG** — xem mục 4 |
| Cấu hình Plesk | KHÔNG |

## 1. Thêm cột `updated_at`

Trong `create_tables()`, thêm một dòng vào khối `dbDelta`, **sau** `noted_at`:

```php
            updated_at DATETIME        NULL,
```

`NULL` là có ý: nó phân biệt **"chưa từng sửa"** với **"đã sửa"**. Nếu đặt
`NOT NULL DEFAULT` một mốc nào đó thì mọi ghi chép cũ đều trông như đã bị sửa, và
giao diện mất khả năng nói thật về chuyện đó — đúng thứ tính năng này sinh ra để giữ.

`dbDelta` tự sinh `ALTER TABLE ... ADD COLUMN` cho bảng đã có. Ghi chép cũ nhận
`NULL`, không cần migrate.

## 2. Đăng ký route

Trong `register_routes()`, sửa khối `/fin/journal/(?P<id>\d+)` thành mảng hai method:

```php
        register_rest_route('fin/v1', '/fin/journal/(?P<id>\d+)', [
            ['methods' => 'PUT',    'callback' => [self::class, 'update'],
             'permission_callback' => $manage],
            ['methods' => 'DELETE', 'callback' => [self::class, 'destroy'],
             'permission_callback' => $manage],
        ]);
```

## 3. Hàm `update()` — thêm vào cuối class

```php
    public static function update(WP_REST_Request $req) {
        global $wpdb;
        $uid = get_current_user_id();
        $id  = absint($req['id']);
        $t   = self::table();

        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT user_id, status FROM $t WHERE id = %d", $id
        ), ARRAY_A);

        if (!$row) {
            return new WP_Error('not_found', 'Không tìm thấy ghi chép', ['status' => 404]);
        }
        if ((int) $row['user_id'] !== $uid) {
            return new WP_Error('forbidden', 'Ghi chép này không thuộc về bạn', ['status' => 403]);
        }
        // Đã bỏ ghi thì không sửa được. 409 chứ không 404: chính chủ biết nó tồn tại
        // (họ vừa bỏ ghi nó), giấu đi chỉ làm khó hiểu.
        if ($row['status'] !== 'posted') {
            return new WP_Error('voided', 'Ghi chép đã bị bỏ ghi, không sửa được', ['status' => 409]);
        }

        // Kiểm tra y hệt store() — sửa mà lỏng hơn lúc tạo thì hàng rào vô nghĩa.
        $b = (array) $req->get_json_params();

        $mood = (string) ($b['mood'] ?? '');
        if (!in_array($mood, self::MOODS, true)) {
            return new WP_Error('bad_mood', 'mood không hợp lệ', ['status' => 400]);
        }
        $flag = (string) ($b['flag'] ?? 'none');
        if (!in_array($flag, self::FLAGS, true)) $flag = 'none';

        $body = trim((string) ($b['body'] ?? ''));
        if ($body === '') {
            return new WP_Error('bad_body', 'body không được rỗng', ['status' => 400]);
        }
        $vn = $b['vnindex'] ?? null;
        $vn = ($vn === null || $vn === '') ? null : number_format((float) $vn, 2, '.', '');

        $now = GDSFIN_Util::now_mysql();

        /*
         * noted_at và created_at KHÔNG có trong mảng này, và đó là điểm mấu chốt của
         * cả tính năng. noted_at là dấu thời gian gốc của cảm nhận; sửa được nó thì
         * ba tháng sau có thể viết lại lịch sử sau khi đã biết kết quả thị trường.
         * Client có gửi noted_at lên cũng bị bỏ qua — không đọc tới nó.
         */
        $wpdb->update($t, [
            'mood'       => $mood,
            'flag'       => $flag,
            'vnindex'    => $vn,
            'body'       => wp_kses_post($body),
            'updated_at' => $now,
        ], ['id' => $id, 'user_id' => $uid]);

        return rest_ensure_response(['id' => (string) $id, 'updated_at' => $now]);
    }
```

## 4. Ảnh khi sửa — KHÔNG cần thêm gì

Đây là chỗ đáng nói: hai endpoint đã có từ patch ảnh **dùng lại được nguyên vẹn**.

- `POST fin/journal/{id}/images` đã kiểm ghi chép thuộc về mình và còn `posted`,
  và đã đếm `MAX_PER_ENTRY` từ **số ảnh đang có trong DB** — nên giới hạn 5 ảnh tự
  động tính cả ảnh cũ còn lại, không phải làm gì thêm.
- `DELETE fin/journal/images/{id}` đã xoá cả bản ghi lẫn file gốc lẫn bản thu nhỏ.

Yêu cầu **"huỷ sửa thì không để file mồ côi"** cũng không cần backend: frontend giữ
ảnh mới trong bộ nhớ và **chỉ gửi lên khi bấm Lưu**. Huỷ thì chưa có gì từng được
tạo ra để mà dọn. Cùng cách đã dùng ở khung soạn bài mới.

Một điểm về **thứ tự** mà frontend phải theo, ghi ở đây để khỏi quên: lúc lưu phải
**xoá ảnh trước, thêm ảnh sau**. Bài đang có 5 ảnh, người dùng bỏ 2 thêm 2 — nếu
thêm trước thì ảnh thứ 6 bị `too_many` chặn dù kết quả cuối vẫn là 5.

## 5. `index()` trả thêm `updated_at`

Thêm một dòng vào mảng trong `array_map`:

```php
            'updated_at' => $r['updated_at'],
```

và thêm `updated_at` vào danh sách cột của câu `SELECT`:

```php
            "SELECT id, mood, flag, vnindex, body, noted_at, updated_at
```

Giá trị `null` nghĩa là chưa từng sửa — giao diện dựa vào đó để quyết định có hiện
"đã sửa lúc…" hay không.

## 6. Soát sau khi áp

```bash
... -e "SHOW COLUMNS FROM wp_fin_journal LIKE 'updated_at'"     # datetime, NULL
... -e "SELECT option_value FROM wp_options WHERE option_name='gdsfin_db_version'"  # 1.11.0
```

Áp xong bảo tôi, tôi chạy bảng đối chiếu: sửa của người khác, sửa bài đã bỏ ghi,
noted_at có bị đổi không, và ảnh khi sửa.
