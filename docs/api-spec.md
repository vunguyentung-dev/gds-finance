# Spec backend — các màn còn lại

Nguồn tham chiếu: `design-bundle/design_handoff_fin_management/VNInvest.dc.html`
(class `Component` ở cuối file). Mọi số dòng trích dẫn trong tài liệu này đều
trỏ vào file đó.

Trạng thái: **spec, chưa cài**. Backend hiện chỉ có `fin/categories`,
`fin/entries`, `fin/summary` (thu/chi cá nhân) và `/transactions` (sổ tiền mặt
tổng quát, **không dùng được cho cổ phiếu** — thiếu `sym`, `qty`, `price`).

---

## 0. Nguyên tắc chung

| Quy ước | Giá trị |
|---|---|
| Namespace | `fin/v1`, route đặt `/fin/<tên>` (nhất quán với `class-fin-personal.php`) |
| Quyền | `fin_view` cho GET, `fin_manage` cho POST/PUT/DELETE |
| `user_id` | luôn `get_current_user_id()`, không nhận từ client |
| Tiền | lưu **ĐỒNG** (`98500`, không phải `98.5`), `DECIMAL(20,4)`, truyền dạng **chuỗi** |
| Tỉ lệ % | `DECIMAL(8,5)`, `0.15000` nghĩa là 0,15% |
| Xóa | **không xóa cứng** — `UPDATE status='void'`; GET mặc định chỉ trả `posted` |
| Số học | **bcmath** (`bcmul/bcadd/bcsub/bcdiv`), tuyệt đối không float |
| Scale | **tính trung gian scale 10**, chỉ cắt về scale 4 khi xuất JSON |
| Làm tròn | **không làm tròn ở tầng lưu trữ và tầng API**; giữ nguyên scale 4. Chỉ làm tròn khi hiển thị |

Lý do không làm tròn: mỗi công ty chứng khoán làm tròn phí khác nhau. Giữ số
gốc thì sau này còn đối chiếu được với sao kê; lưu số đã tròn thì không khôi
phục lại được.

### 0.1 Scale bcmath — bắt buộc scale 10 ở tính trung gian

`bcdiv()` **cắt cụt, không làm tròn**. Sai số bị cắt sẽ nhân với `qty` rồi cộng
dồn qua từng lệnh, nên lệch dần chứ không tự triệt tiêu.

Ba chỗ có phép chia trong pipeline:

| Phép chia | Ở đâu |
|---|---|
| `bf = buy_fee / 100` (và `sf`, `tx`) | cả hai engine, gốc dòng 1120 / 1193 |
| `avg = cost / shares` | engine A, gốc dòng 1128 |
| `pct = realized / sold_base * 100` | engine A, gốc dòng 1143 |

**Minh hoạ sai số** — mua 1000 cp @100.000 rồi mua thêm 500 cp @33.333:

```
cost   = 1000×100000×1.0015 + 500×33333×1.0015 = 116 841 499,75
shares = 1500
avg đúng      = 116 841 499,75 / 1500 = 77 894,3331666666…   (không dừng)
avg cắt scale 4 = 77 894,3331
kiểm tra lại: 77 894,3331 × 1500 = 116 841 499,65
                        lệch ngay = 0,10 đồng
```

Chỉ **một** lệnh đã lệch 0,10 đồng, và `avg` còn được dùng tiếp để tính `base`,
`realized`, `sold_base` cho mọi lệnh bán sau đó.

**Quy tắc cài đặt:**

```php
bcscale(10);                       // hoặc truyền scale 10 vào từng lời gọi
$avg = bcdiv($cost, $shares, 10);  // KHÔNG dùng scale 4 ở đây
// … toàn bộ engine chạy ở scale 10 …
$out = money_out($realized);       // chỉ cắt về 4 ở biên JSON
```

`bcmath` **không có hàm làm tròn**. Cắt về scale 4 ở biên phải tự làm tròn
half-up, có xử lý dấu âm:

```php
function money_out(string $v): string {
    $half = bccomp($v, '0', 10) < 0 ? '-0.00005' : '0.00005';
    return bcadd($v, $half, 4);     // bcadd cắt cụt sau khi cộng -> thành half-up
}
```

Đường dẫn thực tế thành `/wp-json/fin/v1/fin/stock-txns` (lặp chữ `fin`). Đây
là quirk có sẵn của module thu/chi, giữ nguyên cho nhất quán. Nếu đổi thành
`/fin/v1/stock-txns` thì phải sửa cả `frontend/src/api/`.

### 0.2 Bảng con không có `user_id` — bắt buộc verify quyền sở hữu qua bảng cha

`fin_checklist_rows` **không có cột `user_id`** (chủ ý: quyền sở hữu thuộc về
`fin_checklist_runs`). Vì vậy `permission_callback` kiểm `fin_view`/`fin_manage`
là **chưa đủ** — nó chỉ trả lời "user này có quyền dùng tính năng không", không
trả lời "user này có sở hữu `run_id` này không".

**Mọi endpoint đụng tới `rows` (đọc và ghi) phải verify `run_id` thuộc user hiện
tại**, nếu không sẽ bị **IDOR**: user A đoán/sửa `run_id` là đọc và ghi được
checklist của user B.

```sql
-- Bắt buộc chạy TRƯỚC mọi thao tác trên rows
SELECT id FROM {$p}fin_checklist_runs
 WHERE id = %d AND user_id = %d AND status = 'posted';
-- không có dòng nào -> trả 404 (KHÔNG trả 403)
```

Khi ghi, ràng buộc luôn trong câu lệnh thay vì chỉ tin vào kiểm tra phía trên:

```sql
UPDATE {$p}fin_checklist_rows r
  JOIN {$p}fin_checklist_runs n ON n.id = r.run_id
   SET r.row_status = %s, r.val = %s
 WHERE r.run_id = %d AND r.row_key = %s AND n.user_id = %d;
```

Áp dụng cho cả 3 endpoint: `GET .../runs/{id}`, `PUT .../runs/{id}/rows`,
`POST .../runs/{id}/complete`.

Trả **404 chứ không 403** khi `run_id` không thuộc user — trả 403 là xác nhận
"`run_id` này có tồn tại, chỉ không phải của bạn", tức là làm lộ thông tin.

Nguyên tắc tương tự cho các bảng còn lại: `fin_stock_txns`, `fin_rates`,
`fin_journal`, `fin_checklist_runs` đều **có** `user_id`, nên mọi `UPDATE`/`DELETE`
phải kèm `AND user_id = %d` ngay trong câu lệnh, không dựa vào việc đã lọc ở
tầng PHP.

---

## 1. SQL

```sql
-- ============ GIAO DỊCH CỔ PHIẾU ============
CREATE TABLE {$p}fin_stock_txns (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  sym         VARCHAR(12)     NOT NULL,
  txn_type    VARCHAR(4)      NOT NULL,                    -- 'buy' | 'sell'
  txn_date    DATE            NOT NULL,
  qty         BIGINT UNSIGNED NOT NULL,                    -- số cổ phiếu (nguyên)
  price       DECIMAL(20,4)   NOT NULL,                    -- ĐỒNG / cổ phiếu
  status      VARCHAR(15)     NOT NULL DEFAULT 'posted',   -- 'posted' | 'void'
  voided_at   DATETIME        NULL,
  created_at  DATETIME        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_user_status_date (user_id, status, txn_date, id),
  KEY idx_user_sym (user_id, sym, txn_date)
) $charset;

-- ============ BIỂU PHÍ / THUẾ THEO MỐC HIỆU LỰC ============
CREATE TABLE {$p}fin_rates (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  eff_date    DATE            NOT NULL,                    -- áp dụng từ ngày này trở đi
  buy_fee     DECIMAL(8,5)    NOT NULL,                    -- %
  sell_fee    DECIMAL(8,5)    NOT NULL,                    -- %
  tax         DECIMAL(8,5)    NOT NULL,                    -- %
  created_at  DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_eff (user_id, eff_date),
  KEY idx_user_eff (user_id, eff_date)
) $charset;

-- ============ LỊCH NGHỈ LỄ (TẠO NGAY, ĐỂ RỖNG) ============
CREATE TABLE {$p}fin_market_holidays (
  holiday_date DATE         NOT NULL,
  note         VARCHAR(150) NULL,
  PRIMARY KEY (holiday_date)
) $charset;

-- ============ NHẬT KÝ THỊ TRƯỜNG ============
CREATE TABLE {$p}fin_journal (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  mood        VARCHAR(10)     NOT NULL,                    -- greed|up|neutral|down|fear
  flag        VARCHAR(10)     NOT NULL DEFAULT 'none',      -- none|warn|lesson|chance|note
  vnindex     DECIMAL(10,2)   NULL,                        -- tùy chọn
  body        TEXT            NOT NULL,
  noted_at    DATETIME        NOT NULL,                    -- dấu thời gian lúc lưu
  status      VARCHAR(15)     NOT NULL DEFAULT 'posted',
  created_at  DATETIME        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_user_noted (user_id, status, noted_at)
) $charset;

-- ============ CHECKLIST MUA/BÁN ============
CREATE TABLE {$p}fin_checklist_runs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  sym         VARCHAR(12)     NOT NULL,
  rec         VARCHAR(10)     NOT NULL DEFAULT 'watch',    -- buy|sell|watch
  buy_price   DECIMAL(20,4)   NULL,                        -- ĐỒNG/cp
  sell_price  DECIMAL(20,4)   NULL,
  sell_date   DATE            NULL,
  vnindex     DECIMAL(10,2)   NULL,
  done_at     DATETIME        NULL,                        -- đóng dấu khi bấm "✓ Hoàn thành"
  status      VARCHAR(15)     NOT NULL DEFAULT 'posted',
  created_at  DATETIME        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_user_sym (user_id, sym, created_at)
) $charset;

CREATE TABLE {$p}fin_checklist_rows (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id      BIGINT UNSIGNED NOT NULL,
  row_key     VARCHAR(80)     NOT NULL,                    -- vd '9_RSI'
  row_status  VARCHAR(4)      NOT NULL DEFAULT '',         -- 'ok'|'no'|'na'|''
  val         TEXT            NULL,                        -- "Đánh giá của bạn"
  PRIMARY KEY (id),
  UNIQUE KEY uq_run_key (run_id, row_key),
  KEY idx_run (run_id)
) $charset;
```

**Profile (Cài đặt)** — không cần bảng, dùng `wp_usermeta`: `gdsfin_name`,
`gdsfin_broker`, `gdsfin_account`.

`row_key` sinh theo đúng prototype (dòng **1290**):
`key = (d.stt || '') + '_' + (d.sub || d.crit || i)`. Giá trị `row_status` lấy
từ dòng **1299–1300**: `ok` / `no` / `na`, và bấm lại đúng nút đang chọn thì
xóa về `''` (dòng **1284**).

### Hai điểm về thiết kế T+2

**Không lưu `settle_date` vào bảng.** Ngày hàng về là giá trị *dẫn xuất*, tính
lúc đọc. Nếu bake vào cột thì khi thêm lịch nghỉ lễ sẽ phải migrate toàn bộ dữ
liệu cũ. Không lưu ⇒ thêm lễ chỉ sửa hàm tính, **không thay đổi cấu trúc**.

**Bảng `fin_market_holidays` tạo ngay nhưng để rỗng.** Hàm `add_trading_days()`
tham chiếu bảng này từ đầu; bảng rỗng ⇒ không ngày lễ nào ⇒ hành vi **y hệt
prototype gốc** (chỉ bỏ T7/CN). Sau này chỉ `INSERT` là có hiệu lực.

> Giữ bảng rỗng là điều kiện để khớp prototype. Đổ dữ liệu lễ vào thì kết quả
> sẽ lệch so với bản gốc — và lệch có chủ đích, không phải bug.

---

## 2. Bốn công thức gốc — trích dẫn số dòng

### 2.1 `rateFor(date)` — chọn mốc phí/thuế theo ngày giao dịch

**Dòng 1110–1111:**
```js
const rates = [...this.state.rates].sort((a, b) => a.date < b.date ? -1 : 1);
const rateFor = (d) => { let r = rates[0]; for (const x of rates) { if (x.date <= d) r = x; } return r; };
```
Sắp `eff_date` **tăng dần**, rồi lấy mốc **cuối cùng có `eff_date <= txn_date`**.
Nghĩa là mỗi giao dịch dùng biểu phí **có hiệu lực tại ngày giao dịch đó**, không
phải biểu phí hiện hành. Giao dịch có ngày nhỏ hơn mọi mốc thì rơi vào
`rates[0]` (mốc sớm nhất).

### 2.2 Giá vốn khi MUA đã gồm `buyFee`

**Engine A — dòng 1123–1125:**
```js
totalFees += t.qty * t.price * bf;
a.cost    += t.qty * t.price * (1 + bf);
a.shares  += t.qty;
```

**Engine B — dòng 1198:**
```js
lots.push({ qty: t.qty, gross: t.price * (1 + bf), settle });
```

Cả hai engine đều nhân `(1 + bf)`: **phí mua được cộng vào giá vốn**, không hạch
toán riêng. `bf = buy_fee / 100` (dòng 1120 và 1193).

### 2.3 Tiền bán đã trừ `sellFee + tax`

**Engine A — dòng 1130:**
```js
const proceeds = qty * t.price * (1 - sf - tx);
```

**Engine B — dòng 1210:**
```js
const proceeds = soldQty * t.price * (1 - sf - tx);
```

Trừ **một lần cả phí bán và thuế** trong cùng biểu thức. `sf = sell_fee / 100`,
`tx = tax / 100`. Lãi/lỗ thực hiện = `proceeds − giá vốn phần đã bán` (dòng 1132
cho engine A, dòng 1211 cho engine B).

### 2.4 FIFO chỉ khớp lô có `settle <= ngày bán`

**Dòng 1203** — đếm số đã về:
```js
const avail = lots.filter(l => l.settle <= t.date).reduce((n, l) => n + l.qty, 0);
```

**Dòng 1207** — lượt 1, **chỉ** lô đã về:
```js
for (const l of lots) { if (need <= 0) break; if (l.settle > t.date || l.qty <= 0) continue; ... }
```

**Dòng 1208** — lượt 2, lô còn lại **bất kể** `settle`:
```js
for (const l of lots) { if (need <= 0) break; if (l.qty <= 0) continue; ... }
```

Hai lượt là có chủ đích: bán vượt số hàng đã về **vẫn khớp được** (lượt 2 vét
tiếp lô chưa về), chỉ **cảnh báo** chứ không chặn (dòng 1204). `add_trading_days`
ở dòng **1181–1186** — cộng 1 ngày, bỏ T7/CN, lặp tới khi đủ `n`; dùng giờ địa
phương, **không** `toISOString` để tránh lệch UTC.

### 2.5 Engine A cắt số bán theo `shares` đang giữ — và tính phí trên số CHƯA cắt

**Dòng 1127–1131** (chú ý dòng 1127 dùng `t.qty`, dòng 1129 dùng `a.shares`):
```js
totalFees += t.qty * t.price * (sf + tx);        // 1127: qty CHƯA cắt
const avg = a.shares > 0 ? a.cost / a.shares : 0;
const qty = Math.min(t.qty, a.shares);           // 1129: CẮT theo số đang giữ
const proceeds = qty * t.price * (1 - sf - tx);  // 1130: dùng qty ĐÃ cắt
const base = avg * qty;
```

Hai hệ quả **phải cài đúng**, đây là chỗ dễ làm sai nhất của engine A:

**a) Bán vượt số đang giữ thì phần vượt bị bỏ im lặng.** `Math.min` cắt xuống
`a.shares`, engine A **không phát ra cảnh báo nào**. Tín hiệu duy nhất cho biết
có lệnh bán vượt là `t2_state='short'` + `t2_avail` của engine B. Nếu bỏ engine B
thì lệnh bán vượt trở thành vô hình.

**b) Phí và thuế vẫn tính trên số lượng CHƯA cắt** (dòng 1127 dùng `t.qty`, không
phải `qty` đã cắt ở 1129). Nên `total_fees` bao gồm cả phí của số cổ phiếu **chưa
từng được bán**. Xem VD4 mục 4: bán 1500 khi chỉ giữ 1000 ⇒ `total_fees` khai
thêm `150.000 đồng`. Giữ nguyên hành vi này để khớp bản gốc.

> **Đính chính một nhận định dễ mắc.** Cap ở dòng 1129 **không** phải nguồn lệch
> thứ hai giữa hai engine. Về **số lượng**, hai engine luôn cắt bằng nhau:
> engine A cắt bằng `min(t.qty, a.shares)`, engine B cắt gián tiếp vì lượt 2 hết
> lô để vét nên `need` còn dư — và `sold_qty = t.qty − need` luôn ra đúng bằng
> `min(t.qty, tổng lô còn lại)`, mà tổng lô còn lại luôn bằng `a.shares`. VD4 đã
> kiểm: hai engine cùng ra `19.550.000`, `engines_diff = 0`.
>
> Nguồn lệch `engines_diverge` **chỉ có một**: giá vốn bình quân gia quyền (engine A)
> so với giá vốn lô FIFO (engine B) — xem VD2. Lượt 2 ở dòng 1208 ảnh hưởng
> **lô nào** bị khớp (tức giá vốn), không ảnh hưởng **bao nhiêu cp** được khớp.

---

## 3. Endpoint — Giao dịch

### `GET fin/rates`
```json
[ { "id":"1", "eff_date":"2000-01-01", "buy_fee":"0.15000", "sell_fee":"0.15000", "tax":"0.10000" } ]
```
Sort `eff_date` tăng.

**Mốc gốc phải được GHIM thành dữ liệu, không đọc từ hằng số.** Dùng **lazy seed**:
lần đầu user ghi bản ghi (`POST fin/stock-txns` hoặc `POST fin/rates`), nếu
`fin_rates` của user còn rỗng thì `INSERT IGNORE` một dòng
`2000-01-01 / 0.15 / 0.15 / 0.10` (hằng số `BUY_FEE/SELL_FEE/TAX` gốc dòng **825**).
`INSERT IGNORE` dựa vào `UNIQUE uq_user_eff` nên hai request đồng thời không lỗi
trùng khoá.

> **Vì sao không đọc từ hằng số trong code.** Nếu biểu phí gốc chỉ tồn tại dưới
> dạng hằng số PHP thì một lần sửa hằng số đó sẽ **tính lại toàn bộ lãi/lỗ lịch
> sử** theo giá trị mới. Số liệu tài chính đã chốt không được phép đổi vì một lần
> sửa code — nên mốc phí phải là dữ liệu được ghim tại thời điểm phát sinh giao
> dịch.

Hằng số trong code chỉ còn hai vai: giá trị khởi tạo cho lazy seed, và **fallback
chỉ khi chưa kịp seed** (user có giao dịch nhưng `fin_rates` rỗng — xảy ra khi dữ
liệu được chèn trực tiếp vào DB không qua API). Đường chính luôn là mốc đã ghim.

### `POST fin/rates`
```json
{ "eff_date":"2026-01-01", "buy_fee":"0.20000", "sell_fee":"0.20000", "tax":"0.10000" }
→ { "id":"2", "upserted":"insert" }      // "insert" | "update"
```

**Phải là UPSERT, không phải INSERT thuần.** Bảng có `UNIQUE KEY uq_user_eff
(user_id, eff_date)`, nên `INSERT` một mốc đã tồn tại sẽ lỗi duplicate. Prototype
**ghi đè** mốc trùng ngày — hàm `applyRate` dòng **1270–1274**, chỗ ghi đè ở
dòng **1273**:

```js
rates: [...s.rates.filter(r => r.date !== rateDraft.date),
        { date: rateDraft.date, buyFee: bf, sellFee: sf, tax: tx }]
```

Lọc bỏ mốc cùng `date` rồi thêm bản mới vào — tức **ghi đè theo `eff_date`**.
Cài bằng:

```sql
INSERT INTO {$p}fin_rates (user_id, eff_date, buy_fee, sell_fee, tax, created_at)
VALUES (%d, %s, %s, %s, %s, %s)
ON DUPLICATE KEY UPDATE
  buy_fee = VALUES(buy_fee), sell_fee = VALUES(sell_fee), tax = VALUES(tax);
```

Giữ nguyên `created_at` cũ khi update (không đưa vào phần `UPDATE`) để còn biết
mốc được tạo lần đầu khi nào.

> Sửa biểu phí là **thay đổi hồi tố**: mọi giao dịch có `txn_date >= eff_date` sẽ
> được tính lại theo mốc mới ở lần gọi `fin/stock-summary` kế tiếp. Đây là hành vi
> đúng theo thiết kế (`rateFor` mục 2.1), không phải bug — nhưng nghĩa là lãi/lỗ
> đã hiển thị trước đó có thể đổi. Cân nhắc cho client cảnh báo trước khi lưu.

Xóa một mốc phí: prototype dòng **1267** (`rates.filter(x => x !== orig)`). Nếu
cài `DELETE fin/rates/{id}` thì phải chặn xoá mốc cuối cùng — hết mốc thì
`rateFor()` không có gì để trả.

### `POST fin/stock-txns`
```json
{ "sym":"FPT", "txn_type":"buy", "txn_date":"2025-03-12", "qty":"1200", "price":"98500" }
→ { "id":"1" }
```
`price` là **đồng/cp** — client nhập `98,5` (nghìn ₫) rồi ×1000 trước khi gửi.
Validate: `sym` 3–12 ký tự, in hoa; `qty` nguyên > 0; `price` > 0;
`txn_type ∈ {buy, sell}`; `txn_date` định dạng `Y-m-d`.

### `DELETE fin/stock-txns/{id}`
```json
→ { "voided":1 }
```
`UPDATE ... SET status='void', voided_at=NOW() WHERE id=%d AND user_id=%d`.
Không `DELETE`.

### `GET fin/stock-txns`
Bảng **Lịch sử giao dịch**. Kèm số đã tính theo biểu phí của ngày giao dịch —
client không tự tính (công thức gốc dòng **1231**):
```json
[
  { "id":"1", "sym":"FPT", "txn_type":"buy", "txn_date":"2025-03-12",
    "qty":"1200", "price":"98500",
    "net_price":"98647.7500",
    "net_value":"118377300.0000" }
]
```
`net_price` = mua: `price*(1+bf)` · bán: `price*(1-sf-tx)`.
`net_value` = `qty * net_price`.
Sort `txn_date DESC, id DESC`. `?include_void=1` để xem cả dòng đã void.

### `GET fin/stock-summary`
Toàn bộ tính toán của màn. **Hai engine chạy song song, giữ riêng biệt, không hợp nhất.**

```json
{
  "cards": {
    "total_realized":"12410900.0000",
    "total_realized_pct":"31.45",
    "total_net_buy":"118377300.0000",
    "total_net_sell":"51870000.0000",
    "held_count": 1,
    "total_fees":"307300.0000"
  },
  "by_sym": [
    { "sym":"FPT", "shares":"800", "avg_cost":"98647.7500",
      "net_value":"78918200.0000", "sold":"400",
      "realized":"12410900.0000", "realized_pct":"31.45" }
  ],
  "flow": [
    { "id":"1", "sym":"FPT", "txn_type":"buy", "txn_date":"2025-03-12",
      "qty":"1200", "price":"98500",
      "settle_date":"2025-03-14", "t2_state":"settled_future", "t2_avail":null,
      "cash":"-118377300.0000", "row_pl":null,
      "cum_pl":"0.0000", "remain":"1200" },
    { "id":"2", "sym":"FPT", "txn_type":"sell", "txn_date":"2025-06-20",
      "qty":"400", "price":"130000",
      "settle_date":null, "t2_state":"ok", "t2_avail":"1200",
      "cash":"51870000.0000", "row_pl":"12410900.0000",
      "cum_pl":"12410900.0000", "remain":"800" }
  ],
  "footer": {
    "flow_remain":"800",
    "cum_pl":"12410900.0000",
    "total_realized":"12410900.0000",
    "engines_diverge": false,
    "engines_diff":"0.0000"
  }
}
```

**`t2_state`** — backend trả trạng thái + số liệu, client lo chữ và màu:

| Giá trị | Ý nghĩa | Client hiển thị |
|---|---|---|
| `settled_future` | dòng MUA | `Hàng về «settle_date»` |
| `ok` | BÁN, đủ hàng đã về | `✓ Hàng đã về` |
| `short` | BÁN vượt số đã về | `⚠ Chỉ «t2_avail» cp đã về (T+2)` |

**`footer` trả CẢ HAI số lãi/lỗ** — đây là quyết định thiết kế, không phải dư thừa:

- `cum_pl` — engine B (FIFO). **Chân bảng timeline dùng số này**, để khớp với
  cột "Lũy kế" ngay phía trên.
- `total_realized` — engine A (bình quân gia quyền). **Thẻ "Tổng lãi/lỗ đã
  thực hiện" đầu màn dùng số này.**
- `engines_diverge` = `true` khi hai số lệch nhau. Khi đó **UI phải hiện cảnh
  báo nhỏ, không được giấu**.
- `engines_diff` = `cum_pl − total_realized`.

> **Sửa lỗi của prototype gốc.** Dòng **1483** đặt `flowFinalPl` = `totalRealized`
> (engine A) trong khi cột "Lũy kế" ngay trên nó ở dòng **1222** dùng `cumPL`
> (engine B). Chân bảng đang trộn số của hai engine khác nhau — hai số này lệch
> nhau khi có nhiều lô mua khác giá hoặc có lệnh bán vượt hàng về (xem VD2 mục 4).
> Spec này tách rõ hai số và phơi chỗ lệch ra thay vì lặng lẽ chọn một.

---

## 4. Ví dụ số để verify

Điều kiện chung: biểu phí duy nhất `eff_date 2000-01-01`, `buy_fee 0.15`,
`sell_fee 0.15`, `tax 0.10` ⇒ `bf=0.0015`, `sf=0.0015`, `tx=0.001`.
Bảng `fin_market_holidays` **rỗng**.

Các số dưới đây tính bằng số học thập phân chính xác (không float). Áp dụng
xong, kết quả API phải khớp **từng chữ số**.

### VD1 — dữ liệu mẫu prototype (FPT)

```
MUA  1200 @ 98500 đồng/cp  ngày 2025-03-12   (98,5 nghìn ₫)
BÁN   400 @ 130000 đồng/cp ngày 2025-06-20   (130,0 nghìn ₫)
```

`2025-03-12` là **thứ Tư** → `add_trading_days(+2)` = `2025-03-14` (thứ Sáu).

| Mục | Kỳ vọng |
|---|---|
| `by_sym[FPT].shares` | `800` |
| `by_sym[FPT].avg_cost` | `98647.7500` |
| `by_sym[FPT].net_value` | `78918200.0000` |
| `by_sym[FPT].sold` | `400` |
| `by_sym[FPT].realized` | `12410900.0000` |
| `by_sym[FPT].realized_pct` | `31.45` (chính xác `31.4525673…`) |
| `cards.total_fees` | `307300.0000` |
| `cards.total_net_buy` | `118377300.0000` |
| `cards.total_net_sell` | `51870000.0000` |
| `cards.held_count` | `1` |
| `flow[0].settle_date` | `2025-03-14` |
| `flow[0].cash` | `-118377300.0000` |
| `flow[1].t2_avail` | `1200`, `t2_state` = `ok` |
| `flow[1].row_pl` | `12410900.0000` |
| `footer.cum_pl` | `12410900.0000` |
| `footer.total_realized` | `12410900.0000` |
| `footer.engines_diverge` | `false` |

Giải chi tiết: `cost = 1200×98500×1.0015 = 118 377 300` ·
`avg = 118 377 300 / 1200 = 98 647,75` ·
`proceeds = 400×130 000×0.9975 = 51 870 000` ·
`base = 98 647,75×400 = 39 459 100` ·
`realized = 51 870 000 − 39 459 100 = 12 410 900`.

> Lưu ý: VD1 **không** làm hai engine lệch nhau (chỉ một lô mua ⇒ giá vốn bình
> quân trùng giá vốn lô FIFO). Muốn kiểm đường cảnh báo `engines_diverge` thì
> phải dùng VD2.

### VD2 — hai lô mua khác giá ⇒ HAI ENGINE LỆCH NHAU

```
MUA  1000 @ 100000 đồng/cp  ngày 2025-01-06  (thứ Hai → settle 2025-01-08)
MUA  1000 @ 200000 đồng/cp  ngày 2025-02-03  (thứ Hai → settle 2025-02-05)
BÁN  1000 @ 250000 đồng/cp  ngày 2025-03-03  (thứ Hai, cả 2 lô đã về)
```

| Mục | Kỳ vọng |
|---|---|
| `by_sym.avg_cost` | `150225.0000` |
| `by_sym.shares` | `1000` |
| `by_sym.net_value` | `150225000.0000` |
| `by_sym.realized` (engine A) | `99150000.0000` |
| `by_sym.realized_pct` | `66.00` (chính xác `66.0009985…`) |
| `cards.total_fees` | `1075000.0000` |
| `cards.total_net_buy` | `300450000.0000` |
| `cards.total_net_sell` | `249375000.0000` |
| `flow[2].t2_avail` | `2000`, `t2_state` = `ok` |
| `flow[2].row_pl` (engine B) | `149225000.0000` |
| `footer.cum_pl` | `149225000.0000` |
| `footer.total_realized` | `99150000.0000` |
| **`footer.engines_diverge`** | **`true`** |
| **`footer.engines_diff`** | **`50075000.0000`** |

Vì sao lệch: engine A dùng giá vốn **bình quân** `150 225` cho 1000 cp bán ra
(`base = 150 225 000`), còn engine B khớp **FIFO** nên ăn hết lô rẻ trước
(`cost_matched = 1000×100 150 = 100 150 000`). Cùng một `proceeds`
`249 375 000`, chênh giá vốn `50 075 000` chính là `engines_diff`.
**Đây là ca bắt buộc phải test** — nó là lý do tồn tại của quyết định (a).

### VD3 — bán trước khi hàng về ⇒ `t2_state = short`

```
MUA  1000 @ 100000 đồng/cp  ngày 2025-06-16  (thứ Hai → settle 2025-06-18)
BÁN  1000 @ 110000 đồng/cp  ngày 2025-06-17  (thứ Ba — hàng CHƯA về)
```

| Mục | Kỳ vọng |
|---|---|
| `flow[0].settle_date` | `2025-06-18` |
| `flow[1].t2_state` | **`short`** |
| `flow[1].t2_avail` | **`0`** |
| `flow[1].row_pl` | `9575000.0000` |
| `footer.flow_remain` | `0` |
| `footer.cum_pl` | `9575000.0000` |
| `cards.total_fees` | `425000.0000` |

Điểm cần đúng: `t2_avail = 0` (lô settle `06-18` > ngày bán `06-17`) nhưng lệnh
**vẫn khớp** qua lượt 2 (dòng 1208) và `row_pl` vẫn tính đủ. Nếu cài sai thành
"chặn bán" thì `row_pl` sẽ ra `0` — đó là sai so với gốc.
`footer.flow_status` = `Đã bán sạch — lãi/lỗ cuối cùng` (dòng 1485).

### VD4 — bán vượt TỔNG số đang giữ ⇒ cap của engine A + phí trên số chưa cắt

```
MUA  1000 @ 100000 đồng/cp  ngày 2025-01-06  (thứ Hai → settle 2025-01-08)
BÁN  1500 @ 120000 đồng/cp  ngày 2025-02-03  (thứ Hai — chỉ giữ 1000 cp!)
```

| Mục | Kỳ vọng | Ghi chú |
|---|---|---|
| `by_sym.avg_cost` | **`null`** | hết hàng ⇒ hiển thị `—`; xem ghi chú bên dưới |
| `by_sym.sold` | `1000` | **không phải 1500** — cap ở dòng 1129 |
| `by_sym.shares` | `0` | |
| `by_sym.net_value` | `0.0000` | |
| `by_sym.realized` | `19550000.0000` | tính trên 1000 cp |
| `by_sym.realized_pct` | `19.52` (chính xác `19.5207189…`) | |
| **`cards.total_fees`** | **`600000.0000`** | phí bán tính trên **1500** cp |
| `cards.total_net_buy` | `100150000.0000` | |
| `cards.total_net_sell` | `119700000.0000` | tiền bán chỉ của 1000 cp |
| `cards.held_count` | `0` | |
| `flow[1].t2_avail` | `1000`, `t2_state` = `short` | 1500 > 1000 |
| `flow[1].row_pl` | `19550000.0000` | |
| `footer.flow_remain` | `0` | |
| `footer.cum_pl` | `19550000.0000` | |
| `footer.total_realized` | `19550000.0000` | |
| `footer.engines_diverge` | **`false`** | hai engine cắt số lượng bằng nhau |

**Hai điểm VD4 dùng để bắt lỗi cài đặt:**

1. **`total_fees` phải ra `600.000`, không phải `450.000`.** Phí mua `150.000` +
   phí/thuế bán tính trên **1500** cp (`1500×120000×0.0025 = 450.000`). Nếu cài
   dùng `qty` đã cắt thì sẽ ra `150.000 + 300.000 = 450.000` — **sai so với gốc**,
   lệch `150.000 đồng`. Đây là hệ quả của dòng 1127 dùng `t.qty`, xem mục 2.5b.

2. **`engines_diverge` phải là `false`.** VD4 *không* làm hai engine lệch nhau,
   dù có bán vượt. Nếu cài ra `true` ở đây thì logic cap bị sai ở một trong hai
   engine. Ca duy nhất làm lệch là **VD2** (nhiều lô khác giá).

3. **`avg_cost` phải là `null`, không phải `100150.0000`.** Giá vốn bình quân
   `100.150` có tồn tại nhưng chỉ là **giá trị trung gian** dùng để tính `base`
   trong lúc xử lý lệnh bán. Sau khi bán, `shares = 0` nên giá vốn bình quân
   **không còn nghĩa** — gốc dòng **1147** trả `'—'` khi `shares <= 0.0001`:
   `avg: a.shares > 0.0001 ? this.fmt(a.cost / a.shares, 2) : '—'`.
   Tương tự cho `realized_pct`: vẫn có giá trị (`19.52`) vì nó chia cho
   `sold_base`, không phụ thuộc `shares`.

### Bảng đối chiếu nhanh 4 ví dụ

| VD | Kiểm điều gì | `engines_diverge` |
|---|---|---|
| 1 | đường cơ bản, dữ liệu mẫu prototype, T+2 settle | `false` |
| 2 | **giá vốn bình quân vs FIFO** — ca lệch duy nhất | **`true`**, diff `50075000` |
| 3 | `t2_state = short` mà lệnh vẫn khớp qua lượt 2 | `false` |
| 4 | cap theo `shares` + phí trên số chưa cắt | `false` |

Cần cả 4: VD2 kiểm nhánh cảnh báo lệch engine, VD3 và VD4 kiểm hai kiểu "bán
vượt" **khác nhau** (vượt số đã về vs vượt tổng số đang giữ) mà bản gốc xử lý
theo hai cách khác nhau.

---

## 5. Endpoint — các màn còn lại

### Nhật ký thị trường

```
GET  fin/journal?year=2026&month=7&flag=warn     (tham số đều tùy chọn)
POST fin/journal
DELETE fin/journal/{id}        -> { "voided":1 }  (soft, status='void')
```

`GET` trả **mới nhất trên đầu** (`noted_at DESC, id DESC`):
```json
[ { "id":"14", "mood":"fear", "flag":"warn", "vnindex":"1600.00",
    "body":"SSI mua 42.5 giảm về 33…", "noted_at":"2025-11-04 15:00:00" } ]
```

`POST` — `noted_at` do **backend** đóng dấu (`current_time('mysql')`), client
không gửi:
```json
{ "mood":"neutral", "flag":"none", "vnindex":"1312.70", "body":"Thị trường giằng co…" }
→ { "id":"15" }
```

`mood ∈ {greed, up, neutral, down, fear}` (dòng **1308–1313**),
`flag ∈ {none, warn, lesson, chance, note}` (dòng **1316–1321**).
`vnindex` nullable — client gửi `null` khi để trống.

Bộ lọc năm/tháng nên trả kèm danh sách năm có dữ liệu để client dựng dropdown:
`GET fin/journal/years → { "years":[2026,2025] }`.

### Checklist mua/bán

```
GET  fin/checklist/runs?sym=FPT          -> danh sách phiên đánh giá
POST fin/checklist/runs                  -> tạo phiên mới
GET  fin/checklist/runs/{id}             -> head + toàn bộ rows
PUT  fin/checklist/runs/{id}             -> sửa head
PUT  fin/checklist/runs/{id}/rows        -> upsert nhiều row một lượt
POST fin/checklist/runs/{id}/complete    -> đóng dấu done_at
```

> **Bắt buộc:** cả 3 endpoint có `{id}` phải verify `run_id` thuộc user hiện tại
> trước khi đọc/ghi `rows` — xem mục **0.2**. Bảng `fin_checklist_rows` không có
> `user_id`, thiếu bước này là lỗ IDOR.

`GET fin/checklist/runs/{id}`:
```json
{
  "id":"3", "sym":"FPT", "rec":"buy",
  "buy_price":"98500", "sell_price":"130000", "sell_date":"2025-06-20",
  "vnindex":"1312.70", "done_at":null, "created_at":"2026-07-31 10:00:00",
  "rows": [ { "row_key":"9_RSI", "row_status":"ok", "val":"RSI khung 1h đã >30" } ],
  "progress": { "done":5, "total":21 }
}
```

`PUT .../rows` — upsert theo `row_key`, gửi cả mảng:
```json
{ "rows":[ { "row_key":"9_RSI", "row_status":"ok", "val":"…" },
           { "row_key":"1_Phân tích cơ bản", "row_status":"no", "val":"" } ] }
→ { "updated":2 }
```

`progress.done` đếm `row_status='ok'` (dòng **1292**), `total` = số dòng không
phải header trong `checklistDefs` (dòng **903–…**). Nội dung tĩnh
(`crit`/`explain`/`note`) **để ở frontend**, không đưa vào DB — nó là văn bản
thiết kế, không phải dữ liệu người dùng.

`POST .../complete` đóng dấu `done_at = NOW()` (prototype: nút "✓ Hoàn thành"
làm `Thời điểm đánh giá` thành chỉ đọc).

### Cài đặt — profile

```
GET  fin/profile  -> { "name":"Nguyễn Minh", "broker":"VNInvest Securities", "account":"068C123456" }
POST fin/profile     body y hệt, lưu vào wp_usermeta
```

---

## 6. Việc cần làm sau khi áp dụng

- [ ] Tạo 6 bảng ở mục 1 (`fin_market_holidays` **để rỗng**)
- [ ] Seed 1 dòng `fin_rates`: `2000-01-01 / 0.15 / 0.15 / 0.10`
- [ ] Cài `add_trading_days()` có tham chiếu `fin_market_holidays`
- [ ] `bcscale(10)` cho tính trung gian, chỉ cắt scale 4 ở biên JSON qua
      `money_out()` half-up — mục **0.1**
- [ ] Cài 2 engine ở mục 2, dùng bcmath, thứ tự `txn_date ASC, id ASC`
- [ ] Engine A: cap `min(t.qty, shares)` nhưng phí tính trên `t.qty` **chưa cắt**
      — mục **2.5**
- [ ] `POST fin/rates` dùng `ON DUPLICATE KEY UPDATE`, **không** `INSERT` thuần
      (vướng `uq_user_eff`) — mục 3
- [ ] Mọi endpoint `checklist/runs/{id}` verify `run_id` thuộc user, trả **404**
      khi không thuộc — mục **0.2**, chống IDOR
- [ ] `UPDATE`/`DELETE` các bảng khác luôn kèm `AND user_id = %d` trong câu lệnh
- [ ] Verify **VD1, VD2, VD3, VD4** ở mục 4 — khớp từng chữ số.
      Chú ý VD4 `total_fees = 600000` (không phải `450000`) và
      VD2 là ca duy nhất `engines_diverge = true`
- [ ] Bổ sung endpoint mới vào danh sách "Endpoint hiện có" trong `CLAUDE.md`
      (frontend bị chặn không được gọi endpoint ngoài danh sách đó)

Tình trạng từng mục:

| Mục | Nội dung | Đã cài? |
|---|---|---|
| 1–6 | Giao dịch, Nhật ký, Checklist, Cài đặt | **Có** — verify 119 OK / 0 LỆCH |
| 7 | Engine C — khớp lô đích danh | **Backend có** — verify 109 OK / 0 LỆCH; **UI chưa** (7.11) |
| 8 | Giá EOD, tiền mặt, ngành, cổ tức | **Có** — verify 81 OK / 0 LỆCH; còn 2 điểm mở ở 8.12 |
| 9 | Hiển thị nguồn giá trên UI | **Có** — verify 59 OK / 0 LỆCH |

---

## 7. Engine C — khớp lô đích danh (LỚP THÔNG TIN)

Trạng thái: **ĐÃ CÀI** — verify 109 OK / 0 LỆCH. Cài ở file RIÊNG
`class-fin-lots.php`; `GDSFIN_Stock::compute()` không gọi tới nó một dòng nào, nên
ranh giới ở 7.1 được bảo đảm bằng cấu trúc chứ không bằng lời hứa trong comment.
Backend xong, **chưa có UI** — xem 7.10.

### 7.1 Vai trò và ranh giới

Engine C **chỉ trả chi tiết** lệnh bán nào ăn vào lô mua nào. Nó **không được đụng
vào bất kỳ số tổng nào**:

| Thành phần | Nguồn số | Engine C có đổi? |
|---|---|---|
| Thẻ "Tổng lãi/lỗ đã thực hiện" | `cards.total_realized` — engine A | **KHÔNG** |
| Cột "Lũy kế" trong timeline | `flow[].cum_pl` — engine B | **KHÔNG** |
| Chân bảng timeline | `footer.cum_pl` — engine B | **KHÔNG** |
| `by_sym`, `total_fees`, `engines_diverge` | engine A / B | **KHÔNG** |
| Chi tiết lô của một lệnh bán | **engine C** | đây là phần duy nhất nó sinh ra |

Hệ quả phải chấp nhận: giá vốn phần còn nắm theo engine C **sẽ lệch** so với
`by_sym[].net_value` của engine A (bình quân gia quyền). Đây là bản chất của việc
để ba cách nhìn cùng tồn tại, không phải bug. UI **phải ghi nhãn rõ** số nào của
cách tính nào — cùng nguyên tắc đã áp cho `engines_diverge` ở mục 3.

### 7.2 SQL

```sql
CREATE TABLE {$p}fin_stock_lot_matches (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sell_txn_id  BIGINT UNSIGNED NOT NULL,        -- fin_stock_txns.id, txn_type='sell'
  buy_txn_id   BIGINT UNSIGNED NOT NULL,        -- fin_stock_txns.id, txn_type='buy'
  qty          BIGINT UNSIGNED NOT NULL,        -- số cp của lô này bị khớp
  is_manual    TINYINT(1)      NOT NULL DEFAULT 0,
  created_at   DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sell_buy (sell_txn_id, buy_txn_id),
  KEY idx_sell (sell_txn_id),
  KEY idx_buy (buy_txn_id)
) $charset;
```

**KHÔNG lưu `cost_matched`.** Giá vốn tính lúc đọc từ `buy_txn_id`
(`price × (1 + buyFee của ngày mua)`), nên sửa biểu phí là số tự cập nhật theo.
Lưu số đã tính thì nó đóng băng và lệch khỏi engine A/B.

> **`is_manual` — ĐÃ CHỐT là có.** Nó phân biệt dòng do hệ thống tự khớp (được phép
> tính lại) với dòng user ghim tay (không được tự đổi). Thiếu cột này thì mỗi lần
> khớp lại sẽ xoá luôn lựa chọn thủ công của user — xem mục 7.7.

**Không có `user_id`** — quyền sở hữu thuộc `fin_stock_txns`. Áp dụng nguyên tắc
mục **0.2**: mọi endpoint đụng bảng này phải verify `sell_txn_id` thuộc user hiện
tại qua join `fin_stock_txns.user_id`, không thuộc thì trả **404** chứ không 403.

### 7.3 Thuật toán khớp tự động

Khi user không chỉ định tay:

```
1. Lấy các lô MUA cùng mã, status='posted', txn_date <= ngày bán,
   còn hàng chưa bị khớp (qty mua − tổng qty đã khớp ở fin_stock_lot_matches)
2. Sắp theo giá vốn TĂNG DẦN:  gross = price × (1 + buyFee(ngày mua))
   Giá vốn bằng nhau -> lô có txn_date sớm hơn trước; vẫn bằng -> id nhỏ hơn trước
3. Trừ lần lượt từ lô RẺ NHẤT sang lô ĐẮT NHẤT, mỗi lô lấy min(còn lại của lô, còn cần)
4. Hết lô mà vẫn còn cần -> ghi phần khớp được, phần thiếu KHÔNG tạo dòng match
   (nhất quán với engine B: bán vượt vẫn cho, chỉ cảnh báo)
```

Rẻ nhất trước nghĩa là **lãi cao nhất trước**. Đây là lựa chọn có hệ quả, xem 7.6.

### 7.4 T+2 — không chặn, chỉ gắn cờ

Khác engine B (lượt 1 ưu tiên lô đã về), engine C **không xét `settle` khi chọn
lô**. Thứ tự chỉ theo giá vốn. Mỗi dòng khớp trả kèm:

| Trường | Ý nghĩa |
|---|---|
| `settled` | `true` nếu `settle_date <= ngày bán`, ngược lại `false` |
| `settle_date` | ngày hàng về của lô mua, tính lúc đọc (mục 2.4) |

Lô chưa về **vẫn được tính lãi** — UI hiện badge "lô chưa về" để người dùng biết đó
là lãi tạm, không chặn.

### 7.5 Endpoint

#### `GET fin/stock-txns/{id}/lots`

`{id}` là **lệnh bán**. Lệnh mua trả `400`.

```json
{
  "sell_txn_id": "3",
  "sym": "KDH",
  "txn_date": "2026-08-01",
  "qty": "1000",
  "price": "19000.0000",
  "net_unit_price": "18952.5000",
  "matched_qty": "1000",
  "unmatched_qty": "0",
  "matches": [
    { "buy_txn_id": "2", "buy_date": "2026-07-21", "qty": "600",
      "buy_price": "18100.0000", "unit_cost": "18127.1500",
      "cost_matched": "10876290.0000", "pl": "495210.0000",
      "settled": true, "settle_date": "2026-07-23", "is_manual": false },
    { "buy_txn_id": "1", "buy_date": "2026-06-15", "qty": "400",
      "buy_price": "19500.0000", "unit_cost": "19529.2500",
      "cost_matched": "7811700.0000", "pl": "-230700.0000",
      "settled": true, "settle_date": "2026-06-17", "is_manual": false }
  ],
  "matched_pl": "264510.0000",
  "remaining": {
    "qty": "0",
    "cost_basis": "0.0000",
    "market_price": null,
    "unrealized_pl": null,
    "lots": []
  }
}
```

`unit_cost = buy_price × (1 + buyFee(buy_date))` · `cost_matched = qty × unit_cost` ·
`pl = qty × net_unit_price − cost_matched` · `matched_pl = Σ pl`.
Sắp `matches` theo đúng thứ tự đã khớp (rẻ nhất trước).

Bản cài trả thêm, không có trong mẫu trên:

| Trường | Ý nghĩa |
|---|---|
| `matches[].buy_price`, `matches[].unit_cost` | phơi luôn để UI đối chiếu được, không phải gọi thêm |
| `engine`, `engine_note` | nhãn `"C"` + câu giải thích vì sao số này khác A/B. Nhãn engine là **bắt buộc** theo 7.1 |
| `remaining.price` | khối nguồn gốc giá của mục 9.2 — `market_price` không được hiện mà giấu nguồn |
| `remaining.lots[].unit_cost` | giá vốn 1 cp của phần còn nắm |

`matched_pl` **chỉ là thông tin của lệnh bán này**, không được cộng vào bất kỳ
tổng nào của engine A/B.

#### `POST fin/stock-txns` — thêm field tùy chọn

```json
{ "sym":"KDH", "txn_type":"sell", "txn_date":"2026-08-01",
  "qty":"1000", "price":"19000",
  "lot_matches": [ { "buy_txn_id":"2", "qty":"600" }, { "buy_txn_id":"1", "qty":"400" } ] }
→ { "id":"3", "lot_matches_mode":"manual" }   // "auto" khi bỏ trống
```

Bỏ trống `lot_matches` → hệ thống tự khớp theo 7.3, các dòng ghi `is_manual = 0`.
Có `lot_matches` → ghi `is_manual = 1`.

`lot_matches` được kiểm **trước** khi insert lệnh bán, nên một mảng sai không để lại
lệnh rác trong sổ. Engine C chạy **sau** khi sổ gốc đã ghi: nó là lớp dẫn xuất,
không được là điều kiện để lệnh vào được sổ.

Chỉ áp dụng cho `txn_type='sell'`; gửi kèm cho lệnh mua trả **400**.

**Validate `lot_matches` (mọi lỗi trả 400, kèm lý do cụ thể):**

- mỗi `buy_txn_id` phải thuộc **cùng user**, **cùng `sym`**, `txn_type='buy'`,
  `status='posted'`
- `buy_txn_id.txn_date <= txn_date` của lệnh bán (không khớp vào lô mua sau khi bán)
- `qty` mỗi dòng > 0 và **≤ số còn chưa khớp** của lô đó
- `buy_txn_id` không trùng nhau trong mảng
- `Σ qty` phải **đúng bằng** `qty` của lệnh bán — thiếu hoặc thừa đều 400, không
  tự bù phần còn lại

### 7.6 BẮT BUỘC hiển thị kèm lãi/lỗ CHƯA thực hiện

Khớp lô rẻ trước **luôn** làm sổ đã-chốt đẹp lên và đẩy lô giá cao ở lại danh mục.
Chênh lệch không biến mất, nó chuyển sang phần còn nắm. Xem CA2 mục 7.8: engine C
cho lãi cao hơn engine B đúng `560.840`, và giá vốn phần còn nắm cũng cao hơn đúng
`560.840`. Bằng nhau tuyệt đối — đây là số học, không phải trùng hợp.

Vì vậy `remaining` là **phần bắt buộc** của response, và UI **không được** hiện
`matched_pl` mà thiếu nó:

```json
"remaining": {
  "qty": "600",
  "cost_basis": "11437130.0000",
  "market_price": null,
  "unrealized_pl": null,
  "lots": [
    { "buy_txn_id":"2", "buy_date":"2026-07-21", "qty":"200",
      "unit_cost":"18127.1500", "cost_basis":"3625430.0000" },
    { "buy_txn_id":"1", "buy_date":"2026-06-15", "qty":"400",
      "unit_cost":"19529.2500", "cost_basis":"7811700.0000" }
  ]
}
```

> **Chưa có nguồn giá thị trường — ĐÃ CHỐT: trả `null`, không bịa số.** `unrealized_pl`
> cần giá hiện tại, mà màn Bảng giá chưa làm và cần API ngoài. Khi không có giá:
> `market_price` và `unrealized_pl` trả `null`, UI hiện `—` kèm chú thích "cần giá
> thị trường", nhưng **vẫn phải hiện `qty` và `cost_basis`** để người dùng thấy phần
> còn nắm. Tuyệt đối không lấy giá lệnh gần nhất làm giá thị trường.
>
> Khi màn Bảng giá có nguồn giá thật, công thức là:
> `unrealized_pl = qty × market_price × (1 − sellFee − tax) − cost_basis`
> — trừ sẵn phí bán để so cùng cơ sở với `matched_pl`.
>
> **CẬP NHẬT sau khi cài:** đoạn trên viết khi chưa có nguồn giá. Mục 8 và 9 đã
> cài, nên `remaining` gọi `GDSFIN_Market::quotes_for()` và ra được `unrealized_pl`
> thật, kèm khối `price` (nguồn, phiên, độ cũ) theo mục 9.2. Luật cũ vẫn còn hiệu
> lực đúng ở chỗ của nó: mã **chưa có giá nào** thì `market_price`, `unrealized_pl`
> và `price` đều `null` — không lấy giá lệnh gần nhất, không lấy giá vốn làm giá
> thị trường.

### 7.7 Toàn vẹn dữ liệu

Bảng nối tham chiếu hai dòng `fin_stock_txns`, nên có mấy trường hợp phải xử lý,
nếu bỏ qua sẽ ra số vô nghĩa:

| Tình huống | Xử lý |
|---|---|
| Void một lệnh **bán** | xoá các dòng match của nó (dữ liệu dẫn xuất, không phải sổ gốc) |
| Void một lệnh **mua** đang bị khớp | trả **409**, nêu rõ `sell_txn_id` nào đang phụ thuộc; phải void lệnh bán trước |
| Thêm lệnh **mua lùi ngày** trước một lệnh bán đã khớp | khớp lại các dòng `is_manual=0` của các lệnh bán cùng mã có `txn_date >= ngày mua mới`; **giữ nguyên** dòng `is_manual=1` |
| Thêm lệnh **bán lùi ngày** | như trên; nếu lô bị vượt cấp phát thì khớp lại các dòng auto theo thứ tự ngày bán tăng dần |
| Sửa biểu phí (`POST fin/rates`) | **không** cần khớp lại: thứ tự có thể đổi nhưng `cost_matched` tính lúc đọc nên số tự đúng. Nếu muốn thứ tự cũng đúng theo giá vốn mới thì khớp lại các dòng auto |

Sau mọi lần khớp lại, `Σ qty` theo từng `buy_txn_id` phải **≤** `qty` của lệnh mua
đó. Nên có một hàm kiểm tra bất biến này và gọi trong test.

### 7.8 Ví dụ verify — ca KDH

Điều kiện: biểu phí `2000-01-01 / 0.15 / 0.15 / 0.10` ⇒ `bf=sf=0.0015`, `tx=0.001`.
`fin_market_holidays` rỗng.

```
id 1:  MUA  400 @ 19500 đồng/cp   ngày 2026-06-15 (thứ Hai)  -> hàng về 2026-06-17
id 2:  MUA  600 @ 18100 đồng/cp   ngày 2026-07-21 (thứ Ba)   -> hàng về 2026-07-23
id 3:  BÁN 1000 @ 19000 đồng/cp   ngày 2026-08-01 (thứ Bảy)
```

Giá vốn lô: `gross_A = 19500 × 1.0015 = 19.529,25` · `gross_B = 18100 × 1.0015 = 18.127,15`
Đơn giá bán ròng: `19000 × 0.9975 = 18.952,50`

#### CA1 — bán toàn bộ 1000 (đúng dữ liệu bạn nêu)

| Chỉ số | Kỳ vọng |
|---|---|
| `cards.total_realized` (engine A) | `264510.0000` |
| `by_sym[KDH].realized_pct` | `1.42` (chính xác `1.4154010…`) |
| `by_sym[KDH].shares` / `avg_cost` | `0` / `null` (hết hàng) |
| `cards.total_fees` | `75490.0000` |
| `flow[2].t2_avail` / `t2_state` | `1000` / `ok` |
| `flow[2].row_pl` (engine B) | `264510.0000` |
| `footer.cum_pl` (engine B) | `264510.0000` |
| `footer.engines_diverge` | `false` |
| **engine C** `matched_pl` | `264510.0000` |
| engine C match thứ 1 | `buy_txn_id 2`, qty `600`, cost `10876290.0000`, pl `495210.0000`, `settled true` |
| engine C match thứ 2 | `buy_txn_id 1`, qty `400`, cost `7811700.0000`, pl `-230700.0000`, `settled true` |
| `remaining.qty` / `cost_basis` | `0` / `0.0000` |

> **CA1 KHÔNG phân biệt được engine C với engine B.** Lệnh bán ăn hết cả hai lô,
> nên tổng giá vốn khớp giống nhau (`18.687.990`) và `matched_pl` giống nhau
> (`264.510`) — chỉ **thứ tự liệt kê** khác (C: lô 2 trước; B: lô 1 trước). Nếu ai
> cài engine C thành FIFO thì CA1 vẫn pass. Bắt buộc phải test thêm CA2.

#### CA2 — bán MỘT PHẦN 400 @19000 (ca phân biệt B vs C)

Cùng hai lệnh mua, thay `id 3` thành `BÁN 400 @ 19000 ngày 2026-08-01`.
`proceeds = 400 × 18.952,50 = 7.581.000`

| Chỉ số | Engine B (FIFO) | Engine C (rẻ nhất trước) |
|---|---|---|
| Lô bị khớp | `buy_txn_id 1` (mua sớm nhất) | `buy_txn_id 2` (giá vốn thấp nhất) |
| `cost_matched` | `7811700.0000` | `7250860.0000` |
| Lãi/lỗ của lệnh bán | **`-230700.0000`** (LỖ) | **`+330140.0000`** (LÃI) |
| Còn nắm | `600` cp | `600` cp |
| `remaining.cost_basis` | `10876290.0000` | `11437130.0000` |

**Hai đẳng thức phải khớp, đây là chốt kiểm quan trọng nhất của engine C:**

```
chênh lãi/lỗ      = 330140 − (−230700) = 560840
chênh giá vốn còn = 11437130 − 10876290 = 560840      -> BẰNG NHAU
```

Nếu hai số này không bằng nhau thì engine C cài sai. Và chính đẳng thức này là lý
do `remaining` phải bắt buộc hiện kèm: engine C không tạo ra thêm đồng lãi nào, nó
chỉ **dịch chuyển** lãi từ phần còn nắm sang phần đã chốt.

`footer.cum_pl` ở CA2 vẫn phải là **`-230700.0000`** (engine B), **không** đổi theo
engine C — đây là chốt kiểm cho ranh giới ở mục 7.1.

### 7.9 Quyết định đã chốt

| # | Vấn đề | Quyết định | Hệ quả |
|---|---|---|---|
| a | Cột `is_manual` | **CÓ** | Giữ được lựa chọn thủ công qua các lần khớp lại (7.7) |
| b | `unrealized_pl` khi chưa có giá thị trường | **Trả `null`** | Không bịa số. **Đã hết treo:** mục 8/9 cài xong nên `remaining` lấy giá từ `GDSFIN_Market::quotes_for()` và ra được số thật; chỉ khi mã đó chưa có giá nào thì mới `null`. Kèm khối `price` theo mục 9 |
| c | `txn_date` cuối tuần | **Giữ nguyên, không chặn** | `2026-08-01` (thứ Bảy) vẫn nhập được, khớp hành vi prototype gốc |

Không còn điểm treo. Spec mục 7 đã đủ để cài.

### 7.10 Phát sinh khi cài — hai điểm spec chưa nói

**(1) Sổ lệnh CÓ TRƯỚC engine C không có dòng khớp nào.** Khớp tự động chỉ chạy lúc
tạo lệnh, nên mọi lệnh bán đã nằm trong sổ từ trước sẽ ra `matched_qty = 0` — sai
hẳn, không phải thiếu sót nhỏ. Cài `ensure_backfilled()`: khớp bù **một lần** cho
mỗi user, đánh dấu bằng `user_meta gdsfin_lots_backfilled`.

Không khớp bù lười theo từng lệnh bán khi user mở xem: làm vậy thì phân bổ phụ
thuộc vào việc user bấm xem lệnh nào trước — hai người xem theo hai thứ tự sẽ ra hai
kết quả khác nhau. Khớp cả mã một lượt theo ngày bán tăng dần mới xác định.

**(2) Void một lệnh bán giải phóng lô, phải khớp lại.** Bảng 7.7 chỉ nói "xoá các
dòng match của nó". Nhưng lô vừa được giải phóng có thể là lô rẻ mà một lệnh bán
**sau đó** đang thiếu hoặc đang phải lấy lô đắt hơn. Không khớp lại thì để lại phân
bổ cũ đã sai. Bản cài gọi `rematch_symbol()` sau khi void — chỉ chạm dòng
`is_manual = 0`, nên ghim tay của user vẫn nguyên.

### 7.11 UI — ĐÃ CÀI phần đọc

Màn Giao dịch: mỗi lệnh **bán** ở bảng T+2 có nút `lô` mở panel
`LotDetail.tsx`. Hai ràng buộc được cài thành **cấu trúc của panel**, không phải
tuỳ chọn của người viết UI về sau:

- "Đã chốt" và "Còn nắm" là **hai cột cạnh nhau trong cùng một panel**, không tách
  tab, không thu gọn. Không có đường nào trong code hiện `matched_pl` mà thiếu
  `remaining` (7.6)
- mỗi con số có **nhãn engine** (7.1). Panel còn có khối đối chiếu
  **engine B vs engine C vs chênh lệch** cho cùng lệnh bán, kèm câu giải thích chênh
  lệch nằm ở đâu

Giá thị trường trong `remaining` hiện theo mục 9: `21.500` + dòng phụ
`thủ công · 31/07`; chưa có giá thì `chưa có giá` và `— cần giá thị trường`.

Panel tự nạp lại sau khi thêm/void lệnh, vì hai việc đó có thể làm engine C khớp
lại lô (7.7) khiến số đang hiện thành số cũ.

### 7.12 Ghim lô bằng tay — ĐÃ CÀI (verify 63 OK / 0 LỆCH)

#### `GET fin/stock-txns/available-lots?sym=KDH&on=2026-08-01`

```json
{ "sym": "KDH", "on": "2026-08-01", "qty_left_total": "1500",
  "lots": [ { "buy_txn_id": "118", "buy_date": "2026-07-01", "buy_price": "17000.0000",
              "qty_total": "500", "qty_matched": "0", "qty_left": "500",
              "unit_cost": "17025.5000", "settled": true, "settle_date": "2026-07-03" } ] }
```

`on` bỏ trống = hôm nay theo giờ VN. Lọc `buy_date <= on`.

Endpoint này **phải** tồn tại vì `qty_left` là số client **không tự suy ra được**: nó
phụ thuộc dòng khớp của *mọi* lệnh bán khác cùng mã, mà client chỉ thấy sổ lệnh.

**Thứ tự trả về là HỢP ĐỒNG, không phải tiện lợi:** đúng thứ tự engine C sẽ tự khớp
(giá vốn tăng dần), để UI hiện được "không ghim thì hệ thống chọn lô này". Test có
dòng khẳng định lô endpoint xếp đầu đúng là lô hệ thống tự lấy, và khẳng định thứ tự
này **khác** thứ tự ngày mua — nếu ai cài thành sắp theo ngày thì test đổ.

Chỉ trả lô còn `qty_left > 0`; lô đã khớp hết không phải lựa chọn. Lô **chưa về
(T+2) vẫn trả về và vẫn ghim được** — engine C không xét `settle` khi chọn lô (7.4),
cờ `settled` chỉ để UI gắn badge.

#### UI

Form đặt lệnh BÁN có khối `LotPicker` với hai chế độ:

- **Tự động** — bảng lô chỉ để xem, tô nhấn những lô hệ thống sẽ lấy và số lượng lấy
  từ mỗi lô. Cảnh báo khi khối lượng bán vượt tổng còn chưa khớp.
- **Ghim tay** — mỗi lô một ô nhập, kèm bộ đếm `Đã ghim x / y cp` và nút *Điền như
  tự động* để chỉnh từ phân bổ mặc định thay vì gõ lại từ đầu.

Chế độ Tự động **luôn hiện trước**, kể cả khi user định ghim tay: phải thấy "hệ thống
sẽ chọn lô nào" mới biết mình đang ghim khác đi ở đâu, chứ không chọn trong bóng tối.

Client kiểm `Σ ghim = qty` ngay tại form để user sửa được liền, nhưng đó là lớp
**tiện dụng**, không phải lớp bảo đảm — backend vẫn kiểm lại và trả 400.

Panel chi tiết lô ghi nhãn `ghim tay` khi lệnh có dòng `is_manual`, và **đổi cả câu
mô tả**: nói "lô do bạn tự chọn" thay vì "lô rẻ nhất trước" — vì với lệnh ghim tay
thì câu sau là **sai**, engine C có thể cho lãi *thấp* hơn engine B.

---

## 8. Nguồn dữ liệu còn thiếu — giá thị trường, tiền mặt, ngành, cổ tức

Trạng thái: **spec, chưa cài.**

Lý do có mục này: màn **Tổng quan** không dựng được vì 10/11 khối phụ thuộc dữ
liệu chưa tồn tại. Trong prototype, 4 thẻ KPI là **số hard-code trong markup**
(dòng 105/115/120: `2.847,5`, `420,0 tr`, `96,3 tr`), không tính từ state — nên
không có công thức nào để port. Mục này mô tả bốn nguồn dữ liệu để mở đường.

### 8.1 Bốn nguồn và các khối chúng mở

| Nguồn | Mở được |
|---|---|
| **A. Giá thị trường** | Tổng tài sản · Lãi/lỗ phiên gần nhất · biểu đồ Giá trị danh mục · cột Giá TT / Giá trị / Lãi lỗ % trong Danh mục nắm giữ · `unrealized_pl` của engine C (mục 7.6) · toàn bộ màn Bảng giá · biểu đồ màn Phân tích |
| **B. Số dư tiền mặt** | Tiền mặt khả dụng · Tổng tài sản (một nửa còn lại) |
| **C. Ngành + danh mục mã** | Phân bổ theo ngành · cột "Mã + tên" và tab VN30/HOSE/HNX của Bảng giá |
| **D. Cổ tức** | Cổ tức dự kiến / năm · tiêu chí "Cổ tức đều" của Bộ lọc |

**Vẫn chưa mở sau mục này:** dải "Gợi ý phát hiện cổ phiếu tốt" và màn Bộ lọc
(cần chỉ số cơ bản P/E, ROE, tăng trưởng LN), 3 ô digest vĩ mô/tin tức và màn
Tin tức (cần API vĩ mô + API tin). Hai nhóm đó nên tách spec riêng.

### 8.2 Nguyên tắc: tách dữ liệu THAM CHIẾU khỏi dữ liệu người dùng

| Loại | Bảng | `user_id`? | Ai ghi |
|---|---|---|---|
| Tham chiếu thị trường | `fin_symbols`, `fin_quote_history`, `fin_dividends` | **KHÔNG** | cron; nhập tay để bù (8.11) |
| Dữ liệu người dùng | `fin_accounts`, `fin_transactions` (tiền mặt) | **CÓ** | chính user |

Giá và ngành là dữ liệu **toàn thị trường**, giống `fin_market_holidays` ở mục 1 —
nhân bản theo từng user là vừa tốn vừa dễ lệch. Endpoint đọc vẫn kiểm
`fin_view`, nhưng dữ liệu là chung.

> **Dùng lại bảng có sẵn cho tiền mặt.** `wp_fin_accounts` và
> `wp_fin_transactions` **đã tồn tại từ `class-activator.php`** và đang rỗng —
> đúng hình dạng một sổ tiền mặt (`account_id`, `direction in/out`, `amount`,
> `fee`, `tax`, `status`). Không tạo bảng mới; chỉ cần endpoint. Endpoint
> `/fin/v1/transactions` hiện có nhưng thiếu DELETE và thiếu quản lý account,
> và **không nằm trong danh sách endpoint được phép** ở CLAUDE.md.

### 8.3 SQL

```sql
-- ============ A+C: DANH MỤC MÃ (tham chiếu, dùng chung) ============
CREATE TABLE {$p}fin_symbols (
  sym        VARCHAR(12)  NOT NULL,
  name       VARCHAR(150) NOT NULL,
  exchange   VARCHAR(10)  NOT NULL,            -- HOSE | HNX | UPCOM
  sector     VARCHAR(80)  NULL,
  in_vn30    TINYINT(1)   NOT NULL DEFAULT 0,
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  updated_at DATETIME     NOT NULL,
  PRIMARY KEY (sym),
  KEY idx_exchange (exchange, is_active),
  KEY idx_sector (sector)
) $charset;

-- ============ A: GIÁ ĐÓNG CỬA THEO PHIÊN (nguồn sự thật duy nhất về giá) ============
CREATE TABLE {$p}fin_quote_history (
  sym        VARCHAR(12)   NOT NULL,
  trade_date DATE          NOT NULL,
  close      DECIMAL(20,4) NOT NULL,           -- ĐỒNG/cp
  volume     BIGINT UNSIGNED NULL,
  source     VARCHAR(40)   NOT NULL,           -- 'auto:<nhà cung cấp>' | 'manual'
  entered_by BIGINT UNSIGNED NULL,             -- user_id khi source='manual'
  updated_at DATETIME      NOT NULL,
  PRIMARY KEY (sym, trade_date),
  KEY idx_sym_date (sym, trade_date),
  KEY idx_source (source)
) $charset;

-- ============ D: CỔ TỨC CÔNG BỐ (tham chiếu) ============
CREATE TABLE {$p}fin_dividends (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sym        VARCHAR(12)   NOT NULL,
  ex_date    DATE          NOT NULL,           -- ngày GDKHQ
  pay_date   DATE          NULL,
  kind       VARCHAR(10)   NOT NULL,           -- 'cash' | 'stock'
  cash_per_share DECIMAL(20,4) NULL,           -- ĐỒNG/cp, khi kind='cash'
  stock_ratio    DECIMAL(10,6) NULL,           -- vd 0.10 = 10%, khi kind='stock'
  note       VARCHAR(255)  NULL,
  source     VARCHAR(40)   NOT NULL,
  created_at DATETIME      NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sym_ex_kind (sym, ex_date, kind),
  KEY idx_sym_ex (sym, ex_date)
) $charset;
```

`fin_accounts` và `fin_transactions`: **không tạo mới**, dùng nguyên bảng đã có.
Chỉ cần thêm một chỉ mục nếu thấy chậm: `KEY idx_user_status (user_id, status)`.

### 8.4 Giá thị trường — hợp đồng "có thể không có dữ liệu"

Đây là điểm quan trọng nhất của mục này. Giá đến từ nguồn ngoài nên **luôn có khả
năng thiếu hoặc cũ**. Áp dụng đúng nguyên tắc đã chốt ở mục 7.9(b): **trả `null`,
không bịa số**.

#### `GET fin/quotes?syms=FPT,KDH`

```json
{
  "as_of": "2026-08-01 14:45:00",
  "source": "<tên nguồn>",
  "is_stale": false,
  "stale_reason": null,
  "quotes": {
    "KDH": { "trade_date":"2026-08-01", "last":"19100.0000", "prev_close":"18950.0000",
             "ref":"18950.0000", "ceil_price":"20280.0000", "floor_price":"17620.0000",
             "change":"150.0000", "change_pct":"0.79", "volume":"3120000" },
    "FPT": null
  }
}
```

**Quy tắc bắt buộc:**

- Mã không có giá → giá trị `null`, **không** thay bằng giá vốn. Prototype lách
  bằng `mkt = mktLookup[sym] || avg` (dòng 1162) — tức lấy **giá vốn làm giá thị
  trường**, khiến cột "Giá TT" hiển thị giá vốn và lãi/lỗ luôn ra `0%`. **Không
  làm theo.** Đó là số sai trông như số thật.
- `is_stale = true` khi `fetched_at` cũ hơn ngưỡng (xem 8.10 điểm c), kèm
  `stale_reason` để UI hiện được lý do, ví dụ `"nguồn giá không phản hồi từ 13:20"`.
- Không có bản ghi nào → HTTP **200** với `quotes` toàn `null`, **không phải 404**.
  Thiếu giá là trạng thái bình thường, không phải lỗi.

#### `GET fin/quotes/history?sym=KDH&from=2026-05-01&to=2026-08-01`

```json
{ "sym":"KDH", "points":[ {"trade_date":"2026-05-02","close":"23100.0000"} ] }
```

#### `POST fin/quotes/refresh` — chỉ `fin_manage`, hoặc gọi từ WP-Cron

```json
{ "updated": 42, "failed": ["ABC"], "as_of":"2026-08-01 14:45:00" }
```

Nạp giá nên chạy bằng **WP-Cron**, không nạp đồng bộ trong request của người dùng —
nguồn ngoài chậm hoặc treo sẽ làm cả màn treo theo. Endpoint này để chạy tay khi cần.

### 8.5 Số dư tiền mặt — lưu phát sinh, TÍNH số dư lúc đọc

```
GET    fin/accounts                  -> [{id, name, acc_type, currency, opening_bal, is_active}]
POST   fin/accounts                  body {name, acc_type, currency, opening_bal}
GET    fin/cash-movements[?account_id=&from=&to=]
POST   fin/cash-movements            body {account_id, txn_date, direction:'in'|'out', amount, note}
DELETE fin/cash-movements/{id}       -> {voided:1}   (status='void', không xoá cứng)
GET    fin/cash-summary              -> số dư đã tính
```

`GET fin/cash-summary`:

```json
{
  "opening_total": "500000000.0000",
  "deposits": "200000000.0000",
  "withdrawals": "50000000.0000",
  "stock_net_buy": "647970500.0000",
  "stock_net_sell": "209574750.0000",
  "balance": "211604250.0000",
  "as_of": "2026-08-01 14:45:00"
}
```

```
balance = opening_total + deposits − withdrawals − stock_net_buy + stock_net_sell
```

**Chỉ lưu nạp/rút, KHÔNG lưu tác động của lệnh cổ phiếu.** Phần cổ phiếu tính lúc
đọc từ `fin_stock_txns` (`total_net_buy` / `total_net_sell` đã có ở
`fin/stock-summary`). Cùng lý do như "không lưu `cost_matched`" ở mục 7.2: nếu
sinh thêm dòng tiền mặt cho mỗi lệnh thì void một lệnh phải void đúng dòng tiền
tương ứng, và sửa biểu phí sẽ làm số cũ đóng băng lệch khỏi engine A/B.

> **KHÔNG cộng `fin_personal` (thu/chi cá nhân) vào số dư tiền mặt chứng khoán.**
> Đó là chi tiêu đời sống, không phải tiền trong tài khoản chứng khoán. Gộp vào sẽ
> ra một con số không có nghĩa thực tế nào. Hai sổ để riêng.

### 8.6 Ngành và danh mục mã

```
GET fin/symbols[?exchange=HOSE&vn30=1&q=fp]  -> [{sym, name, exchange, sector, in_vn30}]
```

Dùng cho: cột "Mã + tên" và tab VN30/HOSE/HNX của Bảng giá, và ánh xạ mã → ngành
để tính Phân bổ theo ngành. Mã đang nắm mà **không có** trong `fin_symbols` thì
gom vào nhóm `"Chưa phân loại"`, không bỏ khỏi biểu đồ — bỏ đi sẽ làm tổng tỉ
trọng không đủ 100% mà không ai biết vì sao.

### 8.7 Cổ tức

```
GET fin/dividends?syms=KDH,FPT[&year=2026]  -> [{sym, ex_date, pay_date, kind, cash_per_share, stock_ratio}]
```

"Cổ tức dự kiến / năm" của màn Tổng quan:

```
dividend_year = Σ (KL đang nắm của mã) × (Σ cash_per_share công bố có ex_date trong năm hiện tại)
```

> **Đừng lẫn với cổ tức ĐÃ NHẬN.** Cổ tức đã nhận hiện được người dùng ghi ở màn
> Tài chính cá nhân với `cat='Cổ tức'` trong `fin_personal`. Hai con số khác nhau:
> một là **dự kiến theo công bố**, một là **thực nhận**. Nếu báo cáo nào cộng cả
> hai thì sẽ đếm trùng.

### 8.8 `GET fin/overview` — endpoint gộp cho màn Tổng quan

Theo quyết định "tính toán ở backend, client không tự tính", màn Tổng quan nên gọi
**một** endpoint:

```json
{
  "as_of": "2026-08-01 14:45:00",
  "price_coverage": { "held": 1, "priced": 1, "missing": [] },
  "cards": {
    "total_asset":     { "value": "574504250.0000", "available": true,  "reason": null },
    "last_session_pl":     { "value": "2850000.0000", "available": true, "reason": null },
    "last_session_pl_pct": { "value": "0.79",        "available": true, "reason": null },
    "cash_available":  { "value": "211604250.0000", "available": true,  "reason": null },
    "dividend_year":   { "value": null,             "available": false, "reason": "chưa có dữ liệu cổ tức cho mã đang nắm" }
  },
  "holdings": [
    { "sym":"KDH", "name":"Khang Điền", "sector":"Bất động sản",
      "qty":"19000", "avg_cost":"21599.0167", "cost_value":"410381316.6667",
      "last":"19100.0000", "trade_date":"2026-08-01",
      "market_value":"362900000.0000",
      "exit_fee_est":"907250.0000",
      "unrealized_pl":"-48388566.6667", "unrealized_pct":"-11.79",
      "priced": true, "spark": ["23100.0000","22400.0000","19100.0000"] }
  ],
  "sector_alloc": [ { "sector":"Bất động sản", "value":"362900000.0000", "pct":"63.17" } ],
  "portfolio_series": [ { "trade_date":"2026-07-25", "value":"401000000.0000" } ]
}
```

Ba trường tiền của mỗi dòng `holdings` phải **cộng khớp nhau**, đừng gộp lại thành
một số:

```
market_value  = qty × last                       (giá trị theo giá thị trường, CHƯA trừ phí)
exit_fee_est  = market_value × (sellFee + tax)   (phí+thuế nếu bán ngay bây giờ)
unrealized_pl = market_value − exit_fee_est − cost_value
```

Ví dụ KDH ở trên: `19.000 × 19.100 = 362.900.000` · phí bán ước tính
`362.900.000 × 0,25% = 907.250` · `362.900.000 − 907.250 − 410.381.316,6667 =
−48.388.566,6667` (−11,79%).

> **Đây là chỗ spec từng tự mâu thuẫn.** Bản trước ghi `unrealized_pl` ở 8.8 là
> `−47.481.316,6667` (không trừ phí bán) trong khi công thức ở **7.6** có trừ —
> lệch đúng `907.250`. Đã sửa theo 7.6: **trừ phí bán ước tính**, để so được cùng
> cơ sở với lãi/lỗ đã thực hiện (vốn đã gồm phí mua và trừ phí bán).
>
> Ngược lại, **`total_asset` dùng `market_value` CHƯA trừ phí** — chưa bán thì
> chưa mất phí. Hai con số phục vụ hai mục đích khác nhau, và spec nói rõ để không
> ai "sửa cho nhất quán" rồi làm sai một trong hai.

**Mọi thẻ dùng dạng `{value, available, reason}`** thay vì chỉ một con số. Khi
thiếu dữ liệu, UI có `reason` để hiện đúng lý do chứ không hiện `0` — `0` và
"không biết" là hai chuyện khác nhau, và với số tiền thì lẫn hai thứ đó là nguy hiểm.

`price_coverage` cho UI biết đang thiếu giá bao nhiêu mã, để hiện cảnh báo ở đầu
màn thay vì để người dùng tự đoán vì sao tổng tài sản trông thấp.

`portfolio_series` dựng từ `fin_quote_history` × KL nắm giữ **tại từng ngày** (suy
từ `fin_stock_txns`), không phải KL hiện tại × giá cũ — dùng KL hiện tại sẽ vẽ ra
một đường lịch sử sai.

### 8.9 Việc cần làm khi cài mục 8

- [ ] 3 bảng tham chiếu ở 8.3 (`fin_symbols`, `fin_quote_history`, `fin_dividends`);
      **không** tạo mới `fin_accounts`/`fin_transactions`, cũng **không** tạo
      `fin_quotes` — `last`/`prev_close` suy từ `fin_quote_history` (8.11)
- [ ] Mọi mốc thời gian dùng `GDSFIN_Util::now_mysql()/today()/year()/tz()`, **không**
      dùng `current_time()`/`wp_timezone()` — neo cứng GMT+7, không phụ thuộc setting
      site (8.11). Đã dọn hết, không còn ngoại lệ; `grep` để chắc
- [ ] Cron lấy giá EOD **15:05 giờ VN**, chỉ mã đang nắm; nguồn lỗi thì ghi log,
      **không** ghi giá rác. Đặt cron hệ thống thật, đừng dựa vào WP-Cron theo traffic (8.11)
- [ ] Cron **không ghi đè** dòng `source='manual'` — luật cốt lõi ở 8.11
- [ ] Thiếu giá trả `null` + `is_stale`/`reason`; **không** dùng giá vốn thay giá TT
- [ ] `unrealized_pl` trừ phí bán ước tính, `total_asset` thì **không** trừ (8.8)
- [ ] Đổi tên thẻ KPI thành "Lãi/lỗ phiên gần nhất", không dùng "Lãi/lỗ hôm nay" (8.10b)
- [ ] Không nội suy giá cho phiên trống; trả kèm `spark_from`/`spark_to` và
      `series_coverage` (8.11)
- [ ] `balance` tính lúc đọc, chỉ lưu nạp/rút
- [ ] Không cộng `fin_personal` vào tiền mặt chứng khoán
- [ ] Mã ngoài `fin_symbols` gom vào "Chưa phân loại", không loại khỏi biểu đồ
- [ ] `portfolio_series` dùng KL **tại từng ngày**, không dùng KL hiện tại
- [ ] Bổ sung endpoint mới vào danh sách trong `CLAUDE.md`

### 8.10 Quyết định đã chốt về nguồn giá

| # | Vấn đề | Quyết định |
|---|---|---|
| a | Cách lấy giá | **Tự động lấy giá đóng cửa cuối ngày, nhập tay để bù khi thiếu** — chi tiết ở 8.11. Nhà cung cấp cụ thể **chưa chọn**; 8.11 mô tả hợp đồng adapter nên không phải chờ điều đó mới cài được phần còn lại |
| b | Tần suất | **Cuối ngày (EOD)**, không realtime. Nạp lúc **15:05 giờ VN**, bỏ T7/CN và ngày lễ — xem 8.11 |
| c | Ngưỡng `is_stale` | **Theo phiên, không theo đồng hồ**: cũ khi phiên giao dịch gần nhất > `MAX(trade_date)` đang có. Không cần ngưỡng phút |
| d | Một hay nhiều tài khoản tiền | **Còn mở** — xem 8.12 |

Hai hệ quả trực tiếp của (b), phải chấp nhận:

- **Không có "Lãi/lỗ hôm nay" theo nghĩa trong phiên.** Dữ liệu EOD chỉ cho
  `qty × (close phiên gần nhất − close phiên trước)`. Thẻ KPI đổi tên thành
  **"Lãi/lỗ phiên gần nhất"**; giữ tên cũ là nói sai điều mình đang hiển thị.
- **Màn Bảng giá vẫn chưa mở được như thiết kế.** Trần / Sàn / TC / KL là số trong
  phiên, dữ liệu EOD không có. Dựng được nhiều nhất là bảng "giá đóng cửa các mã
  của tôi", không phải bảng giá thị trường 4 tab VN30/HOSE/HNX/Tất cả.

### 8.11 Cơ chế giá: tự động cuối ngày + nhập tay bù

`fin_quote_history` là **nguồn sự thật duy nhất** về giá. Không có bảng "giá mới
nhất" riêng: `last` = `close` của `MAX(trade_date)`, `prev_close` = close của phiên
liền trước. Bỏ bảng `fin_quotes` ở bản spec trước vì với dữ liệu EOD thì
`ref`/`ceil`/`floor` không tồn tại, còn `last`/`prev_close` thì suy được — giữ hai
bảng chỉ tạo cơ hội cho chúng lệch nhau.

#### Luật cốt lõi: NHẬP TAY THẮNG

```
Cron KHÔNG ghi đè dòng có source='manual'.
Ghi đè được dòng có source='auto:*' (giá nhà cung cấp sửa lại thì cập nhật theo).
```

Thiếu luật này thì lần chạy cron kế tiếp xoá sạch phần người dùng vừa sửa tay.
Cùng hình dạng với `is_manual` của engine C ở **7.2** — và cùng một lý do.

#### Hợp đồng adapter nhà cung cấp

Phần còn lại của hệ thống không cần biết giá đến từ đâu. Nhà cung cấp chỉ phải
thoả một hàm:

```php
interface GDSFIN_Quote_Source {
    /** Tên ghi vào cột source, vd 'auto:xyz'. */
    public function name(): string;

    /**
     * @param string[] $syms      danh sách mã cần lấy
     * @param string   $trade_date phiên cần lấy, 'Y-m-d'
     * @return array<string,string|null>  sym => close (chuỗi, ĐỒNG/cp) hoặc null nếu không có
     * @throws Exception khi nguồn lỗi — cron ghi log, KHÔNG ghi giá rác
     */
    public function fetch_closes(array $syms, string $trade_date): array;
}
```

Đổi nhà cung cấp về sau chỉ là viết một class mới; endpoint, bảng, UI không đổi.
Nguồn nào cũng phải kiểm trước: điều khoản sử dụng có cho dùng kiểu này không,
giới hạn số lần gọi, và có đủ mã mình cần không.

#### Múi giờ: neo cứng GIỜ VIỆT NAM trong code, KHÔNG dựa vào setting site

Mọi mốc thời gian nghiệp vụ dùng `GDSFIN_Util::tz()` = **`Asia/Ho_Chi_Minh` (GMT+7)**,
**không** dùng `wp_timezone()` / `current_time()`.

| Thay cho | Dùng |
|---|---|
| `current_time('mysql')` | `GDSFIN_Util::now_mysql()` |
| `current_time('Y-m-d')` | `GDSFIN_Util::today()` |
| `(int) current_time('Y')` | `GDSFIN_Util::year()` |
| `wp_timezone()` | `GDSFIN_Util::tz()` |

Đổi được bằng filter `gdsfin_timezone` nếu sau này phục vụ thị trường khác.

**Vì sao không dựa vào setting site.** Đo trên môi trường local ngày 2026-08-01,
site đang để UTC:

```
  wp_timezone()          = +00:00           (UTC)
  current_time(mysql)    = 2026-08-01 02:26
  giờ VN thật            = 2026-08-01 09:26
  cron "15:05 giờ site"  = 22:05 giờ VN     <-- 7 tiếng SAU khi thị trường đóng
```

Hai hệ quả nếu để phụ thuộc setting, cái thứ hai âm thầm hơn:

1. **Cron nổ sai giờ.** Đặt 15:05 mà thực tế 22:05 giờ VN.
2. **Lệch cả NGÀY trong khoảng 00:00–07:00 giờ VN.** UTC chậm hơn VN 7 tiếng nên
   một ghi chép lúc **06:00 ngày 02/08 giờ VN** bị đóng dấu **01/08**:

   ```
   thời điểm thật (VN)      = 2026-08-02 06:00
   cùng lúc đó theo UTC     = 2026-08-01 23:00
   current_time('Y-m-d')    = 2026-08-01   <-- LỆCH NGÀY
   GDSFIN_Util::today()     = 2026-08-02   <-- ĐÚNG
   ```

   Ảnh hưởng `noted_at` của nhật ký, `done_at` của checklist, `last_trading_day()`.
   Tệ hơn: form frontend mặc định ngày theo **giờ trình duyệt** trong khi backend
   đóng dấu theo **UTC** — hai bên lệch nhau mà không ai báo lỗi.

Frontend cũng neo giờ VN: `todayIso()` trong `lib/format.ts` dùng
`Intl.DateTimeFormat` với `timeZone: 'Asia/Ho_Chi_Minh'` thay vì giờ máy người dùng.

> **Setting timezone của site KHÔNG cần đổi.** Neo cứng trong code nên số liệu đúng
> bất kể site để múi giờ nào, và không ai đổi setting về sau mà làm sai dữ liệu được.
> Nếu vẫn muốn đổi setting cho WordPress core (dấu thời gian bài viết, log) thì cứ
> đổi — hai bên sẽ trùng nhau, không gây lệch kép.

> **Không còn ngoại lệ nào.** Toàn bộ backend đã dùng `GDSFIN_Util`, kể cả
> `class-fin-personal.php` (mặc định `entry_date`, `created_at`, năm mặc định của
> `summary()`) và `class-rest.php` (endpoint `/transactions` cũ). Kiểm bằng:
>
> ```
> grep -rn "current_time\|wp_timezone" backend/includes/*.php backend/gds-finance.php
> # chỉ còn trong comment
> ```
>
> `class-rest.php` quan trọng vì nó ghi vào **cùng bảng** `wp_fin_transactions` mà
> module tiền mặt dùng — để lệch múi giờ thì một bảng có hai chuẩn thời gian.

#### Cron

- Chạy lúc **15:05 giờ VN**, tức sau khi **mọi bảng** đã đóng:

  | Bảng | Kết thúc |
  |---|---|
  | HOSE | ATC 14:45, thoả thuận tới 15:00 |
  | HNX | ATC 14:45, PLO tới 15:00 |
  | UPCOM | giao dịch tới 15:00 |

  Chọn 15:05 thay vì 14:50 nên **không còn** vấn đề UPCOM lấy giá trong phiên —
  một lịch duy nhất phục vụ được cả ba bảng.
- Giờ đặt ở hằng số `GDSFIN_Market::CRON_TIME`, đổi được bằng filter
  `gdsfin_quote_cron_time`. Lịch **tự đặt lại** khi giờ cấu hình đổi — nếu chỉ đặt
  lịch một lần lúc bump DB version thì đổi hằng số sẽ không có tác dụng.
- Chỉ lấy các mã **đang thực sự nắm giữ** (suy từ `fin_stock_txns`, `shares > 0`)
  cộng các mã có phiên checklist đang mở. Không quét cả sàn — vô ích và tốn quota.
- Nguồn lỗi thì **ghi log và bỏ qua**, không ghi `close = 0` hay giá cũ dưới ngày mới.
- Không chạy vào ngày không phải phiên (T7/CN và `fin_market_holidays`).

> **WP-Cron chỉ chạy khi có người truy cập.** Site ít traffic thì cron có thể
> không nổ đúng 15:30. Nên đặt cron hệ thống thật gọi `wp-cron.php` theo giờ, và
> tắt `DISABLE_WP_CRON` mặc định. Đây là thay đổi hạ tầng, không phải code plugin —
> tôi nêu ra để bạn biết chứ không tự làm.

#### Endpoint

```
GET    fin/quotes?syms=KDH,FPT          -> giá suy từ fin_quote_history + cờ cũ/mới
GET    fin/quotes/history?sym=&from=&to=
GET    fin/quotes/gaps                  -> mã đang nắm còn THIẾU giá phiên gần nhất
PUT    fin/quotes/manual                -> nhập/sửa tay, ghi source='manual'
DELETE fin/quotes/manual/{sym}/{date}   -> bỏ giá nhập tay, để cron lấy lại
POST   fin/quotes/fetch                 -> chạy tay đợt lấy giá (fin_manage)
```

`GET fin/quotes` giữ **đúng hợp đồng ở 8.4** (`null` khi thiếu, `is_stale`,
`stale_reason`), thêm `source` để UI phân biệt giá tự động và giá nhập tay:

```json
{
  "as_of": "2026-08-01 15:32:10",
  "last_trading_day": "2026-08-01",
  "is_stale": false,
  "stale_reason": null,
  "quotes": {
    "KDH": { "trade_date":"2026-08-01", "close":"19100.0000", "prev_close":"18950.0000",
             "change":"150.0000", "change_pct":"0.79", "source":"manual" },
    "FPT": null
  }
}
```

`GET fin/quotes/gaps` — đây là thứ điều khiển giao diện nhập tay bù:

```json
{ "last_trading_day":"2026-08-01",
  "missing":[ { "sym":"FPT", "qty":"800", "last_known":{"trade_date":"2026-07-30","close":"98500.0000"} } ] }
```

`PUT fin/quotes/manual` — nhập nhiều mã một lượt:

```json
{ "quotes":[ { "sym":"KDH", "trade_date":"2026-08-01", "close":"19100" } ] }
→ { "upserted": 1 }
```

Validate: `close > 0`; `trade_date` **không được ở tương lai** (chặn cứng, 400);
`sym` phải có trong `fin_symbols` hoặc đang được nắm giữ. Ngày không phải phiên thì
**cho ghi nhưng gắn cảnh báo** trong response — nhất quán với quyết định 7.9(c) là
không chặn ngày cuối tuần.

`DELETE fin/quotes/manual/{sym}/{date}` xoá cứng dòng đó. Đây là dữ liệu **tham
chiếu**, không phải sổ nghiệp vụ của người dùng, nên không cần vết kiểm toán như
`fin_stock_txns` — sửa sai thì xoá cho cron lấy lại là đúng, giữ `status='void'` ở
đây chỉ làm truy vấn phức tạp thêm mà không được gì.

#### Sparkline và biểu đồ khi dữ liệu thưa

Nhập tay thì sẽ có phiên trống. Không nội suy, không lặp giá cũ để lấp:

- `spark` trả các `close` **thực có**, kèm `spark_from` / `spark_to` để UI ghi đúng
  khoảng thời gian thật, thay vì dán nhãn "7 ngày" cho dữ liệu 3 điểm.
- `portfolio_series` chỉ có điểm ở những `trade_date` mà **mọi mã đang nắm** đều có
  giá; phiên nào thiếu một mã thì bỏ phiên đó, và trả `series_coverage` để UI nói
  được là đường biểu đồ dựa trên bao nhiêu phiên trong khoảng đã chọn.

### 8.12 Điểm còn lại cần quyết

**(d) Một hay nhiều tài khoản tiền.** `fin_accounts` cho phép nhiều. Nếu nhiều thì
mọi số tổng (`cash_available`, `total_asset`) phải nói rõ đang gộp tài khoản nào,
và màn Cài đặt cần chỗ quản lý danh sách tài khoản.

**(e) Nhà cung cấp giá.** Chưa chọn, nhưng **không chặn việc cài**: bảng, endpoint,
UI nhập tay bù, cron khung — làm được hết trước. Khi chọn xong chỉ cần viết một
class thoả `GDSFIN_Quote_Source`. Trước khi chốt cần kiểm ba thứ: điều khoản sử
dụng, giới hạn số lần gọi, độ phủ mã mình cần.

---

## 9. Hiển thị nguồn giá trên UI

Trạng thái: **ĐÃ CÀI** — verify 59 OK / 0 LỆCH. Ba việc ở 9.6 đã làm xong.

### 9.1 Nguyên tắc

**Bất cứ nơi nào hiển thị giá thị trường đều phải kèm nguồn và thời điểm lấy.
UI KHÔNG được hiện giá mà giấu nguồn.**

Lý do: giá thị trường là số **đến từ bên ngoài và có thể sai hoặc cũ**, khác hẳn
giá vốn (do người dùng tự nhập, luôn đúng). Một con số trông giống nhau nhưng độ
tin cậy khác nhau thì phải nói rõ, nếu không người dùng sẽ ra quyết định dựa trên
giá đã chết vài phiên mà không biết.

### 9.2 Trường API bắt buộc

Mọi response có giá thị trường phải kèm:

| Trường | Kiểu | Nghĩa |
|---|---|---|
| `close_price` | chuỗi \| null | Giá đóng cửa, ĐỒNG/cp. `null` = chưa có giá |
| `source` | chuỗi \| null | Tên nguồn thắng, vd `auto:ssi`, `manual` |
| `fetched_at` | chuỗi \| null | `Y-m-d H:i:s` — lúc lấy được / lúc người dùng nhập |
| `is_manual` | bool | `true` khi `source = 'manual'` |
| `trade_date` | chuỗi \| null | Phiên mà giá này thuộc về |
| `sessions_behind` | int \| null | Số **phiên giao dịch** giữa `trade_date` và phiên gần nhất. `0` = giá của phiên gần nhất |
| `staleness` | chuỗi | `current` (0 phiên) \| `recent` (1–2) \| `stale` (≥3) \| `none` (chưa có giá) |

`is_manual` là suy ra được từ `source` nhưng vẫn trả riêng: UI dùng nó để chọn cách
hiển thị, và nếu chỉ có `source` thì mỗi nơi lại tự so chuỗi `=== 'manual'` một kiểu.

### 9.3 Chuỗi hiển thị

Ba dạng, đúng thứ tự ưu tiên:

```
có giá tự động   ->  19.000 ₫ · SSI · 01/08 16:30
có giá thủ công  ->  19.000 ₫ · thủ công · 01/08
chưa có giá      ->  chưa có giá
```

**Quy tắc dựng chuỗi:**

1. **Ngày hiển thị là `trade_date`** (phiên mà giá thuộc về), không phải ngày lấy.
2. **Giá tự động: kèm giờ** từ `fetched_at`, vì trong ngày giá có thể được lấy lại.
3. **Giá thủ công: không kèm giờ.** Người dùng tự nhập nên giờ không mang thêm
   thông tin; phiên nào mới là điều cần biết.
4. **Nếu `fetched_at` rơi vào ngày KHÁC `trade_date`** (lấy hôm nay giá của phiên
   trước), hiển thị cả hai để không gây nhầm:
   `19.000 ₫ · SSI · phiên 31/07 · lấy 01/08 16:30`
5. Tên nguồn hiển thị dạng thân thiện: `auto:ssi` → `SSI`, `manual` → `thủ công`.
   Ánh xạ này ở frontend, không hardcode ở backend.

> **Điểm mơ hồ tôi đã tự quyết.** Yêu cầu ghi `"19.000 ₫ · thủ công · 01/08"` mà
> không nói `01/08` là phiên hay ngày nhập. Tôi chọn **phiên** (`trade_date`), vì
> đó là thứ quyết định con số có dùng được không. Quy tắc 4 xử lý trường hợp hai
> ngày khác nhau. Nếu ý bạn là ngày nhập thì nói để tôi sửa.

### 9.4 Cảnh báo giá cũ

| `staleness` | Điều kiện | Hiển thị |
|---|---|---|
| `current` | `sessions_behind = 0` | bình thường |
| `recent` | 1–2 phiên | chữ nguồn/ngày màu `--muted2` |
| `stale` | **≥ 3 phiên** | thêm `⚠` trước chuỗi + toàn bộ dòng phụ màu `--muted2`, tooltip nêu rõ số phiên |
| `none` | chưa có giá | `chưa có giá`, màu `--muted2` |

Ví dụ dạng `stale`: `⚠ 19.000 ₫ · SSI · phiên 28/07 · cũ 3 phiên`

`sessions_behind` đếm bằng **phiên giao dịch**, không phải ngày lịch — dùng chung
logic bỏ T7/CN và `fin_market_holidays` như T+2 (mục 2.4). Nghỉ lễ dài thì đếm theo
ngày lịch sẽ báo động sai.

> **Vì sao cảnh báo nhẹ chứ không chặn:** giá cũ 3 phiên vẫn hữu ích hơn không có
> giá. Chặn hiển thị sẽ khiến người dùng mất luôn thông tin. Nhưng phải thấy được
> là nó cũ — nhất là khi **mọi nguồn cùng chết**, lúc đó số vẫn hiện bình thường
> nhiều ngày liền và đó chính là lúc dễ ra quyết định sai nhất.

### 9.5 Nơi phải áp dụng

| Vị trí | Hiện trạng |
|---|---|
| Màn Tổng quan — cột Giá TT | **Xong** — dòng phụ `nguồn · phiên [· giờ]`, `⚠` khi cũ ≥3 phiên, `chưa có giá` khi thiếu |
| Màn Tổng quan — thẻ Tổng tài sản, Lãi/lỗ phiên gần nhất | **Xong** — dòng phụ ghi nguồn/phiên, gộp thành `n nguồn` khi nhiều mã khác nguồn |
| Màn Tổng quan — biểu đồ Giá trị danh mục | **Xong** — `series_stale`, hiện `⚠` khi điểm cuối cũ ≥3 phiên |
| Màn Giao dịch — `remaining.unrealized_pl` của **engine C** | mục 7 chưa cài; khi cài phải theo mục này |
| Màn Bảng giá, Phân tích | chưa cài; áp dụng ngay từ đầu |

Frontend dùng `lib/price.ts`: `formatPriceWithSource()`, `formatSourceOnly()`,
`sourceLabel()` (`auto:ssi` → `SSI`, `manual` → `thủ công`), `stalePrefix()`,
`staleTooltip()`. Ánh xạ tên nguồn ở frontend, backend không hardcode.

### 9.6 Ba việc đã sửa so với mục 8

**(1) Tên trường `close` → `close_price` — ĐÃ ĐỔI.** `GET fin/quotes` và
`GET fin/quotes/history` hiện trả `close`
(`class-fin-market.php` dòng ~228, ~284). Đổi tên thì phải sửa cả phía đọc:
`frontend/src/api/overview.ts` và `screens/overview/*`. Đây là đổi phá vỡ hợp đồng,
làm một lần dứt điểm, đừng để hai tên song song.

**(2) `fetched_at`, `is_manual`, `sessions_behind`, `staleness` — ĐÃ THÊM.** Cột trong
DB là `updated_at` (bảng `fin_quote_history`), không phải `fetched_at`. **Không cần
migrate**: API cứ trả `fetched_at` lấy giá trị từ cột `updated_at`. Với dòng
`manual` thì `updated_at` chính là lúc người dùng nhập, nên nghĩa vẫn đúng.

**(3) MỘT nguồn → CHUỖI nhiều nguồn — ĐÃ LÀM.** Đây là thay đổi lớn nhất.

Mục 8.11 hiện định nghĩa **một** nguồn duy nhất, cắm qua filter
`gdsfin_quote_source`. Yêu cầu mục này nói tới **"cả 3 nguồn đều lỗi"**, tức cần
chuỗi nguồn có dự phòng. Sửa thành:

```php
// Thay filter số ít bằng danh sách theo thứ tự ưu tiên
$sources = apply_filters('gdsfin_quote_sources', [ /* GDSFIN_Quote_Source[] */ ]);
```

Cách chạy:

```
Với mỗi mã:
  duyệt nguồn theo thứ tự ưu tiên
  nguồn đầu tiên trả về giá hợp lệ (> 0) thì THẮNG -> ghi source = tên nguồn đó
  nguồn lỗi hoặc trả null -> ghi log, thử nguồn kế tiếp
  hết nguồn mà vẫn không có -> KHÔNG ghi dòng nào (giữ nguyên luật "không ghi giá rác")

Dòng source='manual' vẫn luôn thắng mọi nguồn tự động (luật cốt lõi 8.11).
```

Endpoint chẩn đoán, vì "cả 3 nguồn cùng chết" là tình huống cần thấy được từ bên
trong:

```
GET fin/quotes/health
-> { sources_configured, order[], health: [{ source, configured, last_ok_at,
     last_error_at, last_error, attempts_7d, ok_rate_7d }] }
```

`ok_rate_7d` tính từ danh sách lần gọi trong 7 ngày, lưu ở option
`gdsfin_quote_source_health` và tự tỉa các mục cũ hơn 7 ngày.

### 9.7 Điểm cần bạn quyết

**(a) Nhà cung cấp — CHƯA CHỐT, đang xin quyền.** `SSI` trong ví dụ chuỗi hiển thị
chỉ là minh hoạ định dạng, không phải quyết định. Ba nơi đang xin: SSI, VPS, TCBS.
Với mỗi nơi vẫn cần kiểm trước khi cắm vào: điều khoản sử dụng có cho phép dùng
theo cách này, giới hạn số lần gọi, và độ phủ mã mình cần.

**(b) Ba nguồn — ĐÃ BIẾT TÊN, chưa có quyền truy cập.** Người dùng có tài khoản ở
**SSI**, **VPS**, **TCBS** và đang xin quyền dùng API. **Thứ tự ưu tiên chưa chốt.**

Vì vậy làm theo hai bước:

1. Cài **khung chuỗi nguồn** (filter `gdsfin_quote_sources`) + nhập tay bù. Chạy
   được ngay, không phụ thuộc bên nào.
2. Khi có quyền từng nơi thì thêm một class thoả `GDSFIN_Quote_Source` cho nơi đó
   và đưa vào danh sách. Thứ tự ưu tiên đặt bằng thứ tự trong mảng, đổi được không
   cần sửa code lõi.

Chưa xin được nơi nào thì app vẫn dùng được hoàn toàn bằng giá nhập tay — chỉ là
phải nhập mỗi phiên.

**(c) Ngưỡng `stale` = 3 phiên có áp cho cả `sparkline` và biểu đồ không?** Hiện
biểu đồ chỉ báo `x/y phiên có đủ giá`. Có cần thêm `⚠` khi điểm cuối cũ ≥ 3 phiên?
