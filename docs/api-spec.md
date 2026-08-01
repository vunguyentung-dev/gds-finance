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

Mục **7 (engine C — khớp lô đích danh)** là phần bổ sung ĐỘC LẬP, chưa cài. Mục 1–6
đã cài và verify 119 OK / 0 LỆCH. Ba quyết định thiết kế của mục 7 đã chốt ở **7.9**,
spec đủ để cài.

---

## 7. Engine C — khớp lô đích danh (LỚP THÔNG TIN)

Trạng thái: **spec, chưa cài.** Mục 1–6 đã cài và verify xong; mục này là phần bổ
sung độc lập.

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
> Hệ quả cần chấp nhận tới lúc đó: yêu cầu "bắt buộc hiện lãi/lỗ chưa thực hiện"
> chỉ đáp ứng được **một nửa** (số lượng và giá vốn phần còn nắm), chưa ra được
> con số lãi/lỗ. Nửa còn lại phụ thuộc màn Bảng giá.

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
| b | `unrealized_pl` khi chưa có giá thị trường | **Trả `null`** | Không bịa số; phần lãi/lỗ chưa thực hiện chỉ đủ khi làm xong màn Bảng giá (7.6) |
| c | `txn_date` cuối tuần | **Giữ nguyên, không chặn** | `2026-08-01` (thứ Bảy) vẫn nhập được, khớp hành vi prototype gốc |

Không còn điểm treo. Spec mục 7 đã đủ để cài.
