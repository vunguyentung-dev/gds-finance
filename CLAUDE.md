# GDS Finance — Quy ước dự án

## Bối cảnh
Port prototype "FIN MANAGEMENT (FM)" (bản gốc lưu localStorage) sang WordPress plugin có backend thật.
Nguồn thiết kế: design-bundle/design_handoff_fin_management/
  - README.md: đặc tả đầy đủ 10 màn, design token, công thức nghiệp vụ
  - VNInvest.dc.html: prototype gốc (markup + class Component chứa logic)
  - screenshots/: ảnh từng màn, dùng để đối chiếu pixel

## THỨ TỰ TRIỂN KHAI — bắt buộc tuân thủ
1. App Shell (vỏ ứng dụng) — LÀM TRƯỚC TIÊN
2. Màn Tài chính cá nhân
3. Màn Giao dịch cổ phiếu (T+2 FIFO)
4. Nhật ký, Checklist
5. Tổng quan
6. Bảng giá, Phân tích, Bộ lọc, Tin tức (cần API ngoài)
KHÔNG build màn nội dung khi chưa có App Shell.

## APP SHELL — đặc tả bắt buộc
App chạy TOÀN MÀN HÌNH, không nằm trong khung nội dung của theme WordPress.
- Layout gốc: grid 2 cột `grid-template-columns: 236px 1fr`, `height:100vh`, `overflow:hidden`
- Cột trái = Sidebar cố định 236px, nền `--sidebar`:
  - Logo: ô vuông 36x36, bo 10px, nền `--accent`, chữ "V" trắng + tên "VNInvest"
  - 10 mục theo đúng thứ tự: Tổng quan, Bảng giá, Giao dịch, Tài chính cá nhân,
    Phân tích, Bộ lọc cổ phiếu, Checklist mua/bán, Nhật ký thị trường, Tin tức, Cài đặt
  - Mục đang chọn: nền `--accentSoft`, chữ `--accentInk`, font-weight 700, chấm vuông 7px
  - Mục thường: chữ `--muted`, font-weight 600
- Cột phải = Topbar (đứng yên) + vùng nội dung `overflow-y:auto`
  - Topbar: breadcrumb nhỏ (vd "Cá nhân") + tiêu đề màn (vd "Tài chính cá nhân"),
    bên phải: thẻ VN-Index, thẻ HNX, nút chuyển nền Sáng/Tối
  - Bảng breadcrumb/tiêu đề từng màn: xem object `titles` trong VNInvest.dc.html
- Điều hướng bằng state `screen` (không dùng react-router, app nằm trong 1 trang WP)
- Màn chưa làm: hiển thị placeholder "Màn này đang được phát triển", KHÔNG để trắng hoặc lỗi
- Hai theme Sáng/Tối, đổi tại chỗ bằng cách ghi đè CSS custom properties (object `themes`)

## Môi trường
- Máy dev: Mac Mini M4 (arm64), Node 22, WordPress local qua Docker cổng 8080
- Máy chủ thật: Plesk 18, PHP 8.3, MariaDB — KHÔNG có Node/Docker
- Build trên Mac, đẩy lên hosting dạng file tĩnh

## Kiến trúc
- WordPress lo auth/user/role; nghiệp vụ trong plugin backend/
- Bảng SQL riêng wp_fin_*; KHÔNG dùng custom post type
- Frontend React + Vite + TS, build ra backend/assets/dist/app.js + app.css
- Mount vào #gdsfin-root (do page template fullscreen của plugin cung cấp)

## ĐƠN VỊ TIỀN — nguồn sai sót lớn nhất
- DB lưu theo ĐỒNG: thu/chi (45000000), giá cổ phiếu theo đồng/cp
- API truyền `amount` dạng CHUỖI để không mất chính xác số lớn
- Mọi ô nhập tiền theo ĐỒNG đầy đủ. KHÔNG nhân/chia 1000 ở bất kỳ đâu.
  Giá cổ phiếu nhập theo đồng/cp (98500, không phải 98,5).
  Hiển thị cũng theo đồng đầy đủ, không quy đổi ra "tr".
- Định dạng VN khi hiển thị (. ngăn nghìn, , thập phân, − âm)
- Không cộng dồn tiền bằng float ở client; ưu tiên dùng số đã tính sẵn từ endpoint summary

## Ràng buộc kỹ thuật
- Mọi API call qua frontend/src/api/client.ts
- Base URL từ window.GDSFIN.restUrl, header X-WP-Nonce = window.GDSFIN.nonce
- credentials: 'same-origin'
- KHÔNG tạo endpoint ngoài danh sách dưới
- KHÔNG dùng localStorage/sessionStorage cho dữ liệu nghiệp vụ (đây chính là thứ đang loại bỏ)
- user_id KHÔNG gửi từ client; backend tự lấy từ session
- Mỗi màn xử lý đủ 4 trạng thái: loading, empty, error, forbidden(401)

## Endpoint hiện có (chỉ dùng những cái này)
- GET    fin/categories        -> { in:[...], out:[...] }  (KHÔNG có khoá inv_*)
- GET    fin/entries           -> [{id, entry_type, amount, cat, note, entry_date}]
- POST   fin/entries           body {entry_type:'in'|'out'|'inv_in'|'inv_out',
                                     amount(đồng, chuỗi), cat, note, entry_date}
                               cat CHỈ gửi cho 'in'/'out'; loại inv_* backend tự đóng cat
- DELETE fin/entries/{id}      409 nếu xóa inv_in làm vốn ròng âm
- GET    fin/summary?year=YYYY -> {year, years[], monthly[12]{in,out}, catTotals{}, inYear, outYear, net}
                               KHÔNG đếm inv_in/inv_out vào bất kỳ số nào ở đây
- GET    fin/invested          -> {in, out, net} vốn nộp/rút TK chứng khoán,
                               CỘNG DỒN TOÀN BỘ lịch sử, không nhận year/month

## Đầu tư tài chính — xem api-spec mục 14
entry_type 'inv_in'/'inv_out' là CHUYỂN TIỀN giữa hai túi của chính user, KHÔNG phải
thu/chi. Chúng KHÔNG vào Thu/Chi tháng, Thu/Chi năm, biểu đồ 12 tháng, chi tiêu theo
loại, dòng tiền ròng. Gộp vào là méo báo cáo sinh hoạt (nạp 1 tỷ hiện thành tháng chi
1 tỷ). Nhánh `else` trong summary() bắt mọi thứ khác 'in', nên phải chặn tường minh.
Cột entry_type là VARCHAR(10): VARCHAR(3) cắt âm thầm cả hai thành 'inv', mất chiều tiền.
Vốn ròng không được âm — chặn ở CẢ POST (rút quá số nộp) và DELETE (xóa lệnh nộp).
CATS['out'] vẫn có danh mục chi tên 'Đầu tư'; bản ghi cũ đó VẪN là chi, không migrate.
Vì vậy nhãn trong sổ là "Nộp vào TK"/"Rút khỏi TK", không dùng chữ "Đầu tư".

## Endpoint cổ phiếu / thị trường (mục 3, 7, 8, 9 của docs/api-spec.md)
- GET|POST   fin/stock-txns          POST nhận thêm lot_matches (tùy chọn, chỉ lệnh bán)
- DELETE     fin/stock-txns/{id}     void lệnh mua đang bị khớp -> 409
- GET        fin/stock-txns/{id}/lots  engine C: chi tiết lô + remaining (BẮT BUỘC đi kèm)
- GET        fin/stock-txns/available-lots?sym=&on=  lô còn hàng chưa khớp, để ghim tay
                                         thứ tự trả về = thứ tự engine C sẽ tự chọn
- GET        fin/stock-summary       engine A (by_sym, cards) + engine B (flow, footer)
- GET|POST   fin/rates
- GET|POST   fin/symbols
- GET        fin/quotes | fin/quotes/history | fin/quotes/gaps | fin/quotes/health
             fin/quotes/history trả thêm coverage + indicators (MA20/MA50/RSI14/MACD)
             fin/quotes trả thêm band (biên phiên này) + next_band (phiên kế tiếp);
             null khi chưa biết sàn hoặc chưa có TC — KHÔNG đoán biên HOSE
- PUT        fin/quotes/manual · DELETE fin/quotes/manual/{sym}/{date} · POST fin/quotes/fetch
- GET|POST   fin/dividends
- GET|POST   fin/accounts · GET fin/cash
- GET        fin/overview

## Endpoint tin tức (mục 13 của docs/api-spec.md)
- GET      fin/news[?scope=all|portfolio&limit=]  lọc theo mã đang nắm (engine A)
- POST     fin/news/fetch        nạp tay, trả kết quả TỪNG nguồn
- PUT      fin/news/{id}/flag    body {flag:'save'|'watch'|''}  cờ do USER tự gắn
- GET|POST fin/news-feeds · DELETE fin/news-feeds/{id}

## BA ENGINE — không hợp nhất, mọi số hiện ra phải có NHÃN ENGINE
- A bình quân gia quyền -> by_sym, cards
- B FIFO khớp lô đã về  -> flow, footer
- C khớp lô rẻ nhất trước (đích danh) -> fin/stock-txns/{id}/lots
Ba engine ra BA số khác nhau trên cùng một lệnh bán. Đó là thiết kế, không phải bug.
KHÔNG hiện matched_pl của engine C mà thiếu remaining: chênh lệch không mất đi,
nó chuyển sang phần còn nắm.

Giao dịch cổ phiếu (chi tiết + ví dụ response: docs/api-spec.md):
- GET    fin/stock-txns[?include_void=1] -> [{id, sym, txn_type, txn_date, qty, price, net_price, net_value}]
- POST   fin/stock-txns       body {sym, txn_type:'buy'|'sell', txn_date, qty, price(đồng/cp, chuỗi)}
- DELETE fin/stock-txns/{id}  -> {voided:1}  (void mềm, không xóa cứng)
- GET    fin/stock-summary    -> {cards, by_sym[], flow[], footer}
- GET    fin/rates            -> [{id, eff_date, buy_fee, sell_fee, tax}]
- POST   fin/rates            body {eff_date, buy_fee, sell_fee, tax}  (upsert theo eff_date)

Nhật ký thị trường:
- GET    fin/journal[?year=&month=&flag=] -> [{id, mood, flag, vnindex, body, noted_at}]
- GET    fin/journal/years    -> {years:[...]}
- POST   fin/journal          body {mood, flag, vnindex|null, body}   (noted_at do backend đóng dấu)
- DELETE fin/journal/{id}     -> {voided:1}

Checklist mua/bán:
- GET    fin/checklist/runs[?sym=]        -> [{id, sym, rec, done_at, created_at}]
- POST   fin/checklist/runs               body {sym, rec}
- GET    fin/checklist/runs/{id}          -> {…head, rows[], progress{done,total}}
- PUT    fin/checklist/runs/{id}          body {rec, buy_price, sell_price, sell_date, vnindex}
- PUT    fin/checklist/runs/{id}/rows     body {rows:[{row_key, row_status:'ok'|'no'|'na'|'', val}]}
- POST   fin/checklist/runs/{id}/complete -> {done_at}

Cài đặt:
- GET    fin/profile          -> {name, broker, account}
- POST   fin/profile          body {name, broker, account}

Dữ liệu thị trường (mục 8 của docs/api-spec.md):
- GET    fin/symbols[?exchange=&vn30=1&q=] -> [{sym, name, exchange, sector, in_vn30}]
- POST   fin/symbols          body {sym, name, exchange, sector, in_vn30}   (upsert)
- GET    fin/quotes?syms=A,B  -> {as_of, last_trading_day, is_stale, stale_reason, quotes{}}
                                 mã thiếu giá trả null — KHÔNG lấy giá vốn thay thế
- GET    fin/quotes/history?sym=&from=&to=
- GET    fin/quotes/gaps      -> mã đang nắm thiếu giá phiên gần nhất
- PUT    fin/quotes/manual    body {quotes:[{sym, trade_date, close}]}  (ghi source='manual')
- DELETE fin/quotes/manual/{sym}/{date}
- POST   fin/quotes/fetch     -> chạy tay đợt nạp giá EOD
- GET    fin/dividends[?syms=&year=]
- POST   fin/dividends        body {sym, ex_date, kind, cash_per_share|stock_ratio}

Tiền mặt tài khoản chứng khoán:
- GET/POST fin/accounts       -> [{id, name, acc_type, currency, opening_bal, is_active}]
- GET/POST fin/cash-movements body {account_id, txn_date, direction:'in'|'out', amount, note}
- DELETE   fin/cash-movements/{id}  -> {voided:1}
- GET      fin/cash-summary   -> balance TÍNH lúc đọc, không cộng fin_personal vào

Tổng quan:
- GET fin/overview[?days=90]  -> {price_coverage, cards, holdings[], sector_alloc[],
                                  portfolio_series[], series_coverage, cash}
  Mọi thẻ dạng {value, available, reason} — phân biệt "bằng 0" với "không biết".
  Thẻ là "Lãi/lỗ phiên gần nhất", KHÔNG phải "hôm nay" (dữ liệu EOD).
  holdings: market_value chưa trừ phí · exit_fee_est · unrealized_pl đã trừ phí bán.
  total_asset dùng market_value CHƯA trừ phí.

Lưu ý khi dựng UI Giao dịch: backend đã tính sẵn lãi/lỗ, client KHÔNG tự tính.
footer trả CẢ HAI số — cum_pl (engine FIFO, dùng cho chân bảng timeline) và
total_realized (engine bình quân, dùng cho thẻ đầu màn) — kèm engines_diverge;
khi engines_diverge=true PHẢI hiện cảnh báo, không được giấu.

## Màn Bảng giá — xem api-spec mục 10
Giá EOD, KHÔNG realtime. Trần/Sàn là số SUY RA từ TC theo biên độ sàn
(HOSE 7% · HNX 10% · UPCOM 15%) + bước giá, không phải số lấy từ sàn.
Cột KL để trống: fin_quote_history không có cột volume.
Số Trần/Sàn trong ảnh thiết kế là hardcode và tự mâu thuẫn — KHÔNG sửa code cho
khớp ảnh, xem bảng đối chiếu ở mục 10.1.

## Màn Phân tích — xem api-spec mục 11
Nhúng widget TradingView. TradingView KHÔNG cấp phép dữ liệu HOSE/HNX/UPCOM cho
widget nhúng: mã đúng, tích hợp đúng (NASDAQ:AAPL dựng bình thường), nhưng biểu đồ
bị thay bằng "Mã giao dịch này chỉ có trên TradingView". KHÔNG phải lỗi code —
đừng đi sửa tên mã hay cấu hình widget. Đường dùng được: nút Mở trên TradingView.
Biểu đồ CHÍNH tự dựng từ fin_quote_history (api-spec mục 12); TradingView là nguồn
PHỤ, mặc định đóng. Chỉ báo RSI/MACD/MA tính ở BACKEND từ chuỗi giá đóng cửa —
chúng chỉ cần giá đóng cửa, cái thiếu là SỐ PHIÊN (RSI 15, MA20 20, MACD 26, tín
hiệu 34). Thiếu phiên thì trả null + "cần N phiên, đang có M", KHÔNG bịa số.
Không vẽ nến (thiếu mở/cao/thấp), không nội suy phiên trống.
Số RSI/MACD trong ảnh thiết kế là chuỗi hardcode.

## Màn Tin tức — xem api-spec mục 13
Ba nguồn RSS mặc định là HẰNG SỐ trong code, không xoá được; user thêm nguồn riêng
ở màn Cài đặt. Nguồn lỗi bị bỏ qua, KHÔNG chặn cả màn. Cron 2 giờ + nút Làm mới,
xoá tin cũ hơn 30 ngày.
BẢN QUYỀN: chỉ tiêu đề + tóm tắt từ RSS + link về nguồn. KHÔNG lấy toàn văn.
KHÔNG có nhãn Tốt/Xấu tự động và KHÔNG có số liệu vĩ mô — user tự gắn cờ.
Badge trên thẻ tin là TÊN NGUỒN, không phải chủ đề suy đoán.
Khớp mã: biên phải là \p{L}\p{N} chứ KHÔNG phải [A-Z0-9] — dùng [A-Z0-9] thì
"HPGas" khớp mã "HPG". Phân biệt hoa/thường để "gas" không khớp "GAS".

## Design token (theme Sáng)
--bg #faf9f7 · --panel #ffffff · --sidebar #ffffff · --border #eceae6
--fg #18181b · --muted #71717a · --muted2 #a1a1aa · --chip #e4e4e7
--accent oklch(0.54 0.16 265) · --accentSoft oklch(0.95 0.03 265) · --accentInk oklch(0.45 0.16 265)
--up oklch(0.55 0.15 150) · --down oklch(0.58 0.19 25)
--heroBg oklch(0.54 0.16 265) · --heroFg #ffffff
Theme Tối: xem object `themes` trong VNInvest.dc.html.
Font: Manrope (UI/heading), IBM Plex Mono (số liệu, font-feature 'tnum').
Bo góc: thẻ 16px, card lớn 20px, nút/input 10-11px, badge 20px.
Gap chính 14-16px, padding thẻ 18px.

## Phạm vi được sửa
- ĐƯỢC: frontend/
- KHÔNG đụng: backend/, design-bundle/, infra/
  Nếu cần đổi gì trong backend/, hãy MÔ TẢ cho người dùng tự áp dụng.

## Git
- Không commit thẳng develop; tạo nhánh feature/<việc>-<YYYYMMDD>
- Chạy npm run build trước khi báo hoàn thành

## Ranh giới thao tác — bắt buộc hỏi trước
- KHÔNG đổi mật khẩu, tạo/xóa tài khoản người dùng
- KHÔNG chèn/sửa/xóa dữ liệu trong database ngoài dữ liệu test do chính mình tạo và dọn ngay
- KHÔNG thay đổi cấu hình WordPress (template trang, settings, plugin khác)
- Cần làm những việc trên: MÔ TẢ cho người dùng tự thực hiện

## Nới phạm vi tạm thời — để cài mục 7, 8, 9 của api-spec
Được sửa backend/ CHỈ để cài mục 7 (engine C khớp lô đích danh), mục 8 (giá EOD,
tiền mặt, ngành, cổ tức) và mục 9 (hiển thị nguồn giá), trên nhánh riêng.
Cả ba đã cài xong ở backend, engine C đã có UI đủ cả đọc và ghim lô bằng tay.
Ràng buộc giữ nguyên: KHÔNG làm ĐỔI SỐ của fin/entries, fin/summary, và engine A/B.
Bắt buộc: verify bằng dữ liệu thật đang có trong DB, in bảng đối chiếu
"kỳ vọng vs thực tế". Không báo hoàn thành nếu còn dòng lệch.
KHÔNG làm ĐỔI SỐ của endpoint fin/entries, fin/summary, và engine A/B
(đã verify 119 OK) — nếu số nào của chúng đổi thì đó là lỗi.
Được sửa class-fin-personal.php cho việc chuẩn hoá múi giờ về GMT+7
(đã làm xong, đã chứng minh số không đổi byte-for-byte).

## Nới phạm vi tạm thời — chỉ để áp patch đầu tư tài chính
Được sửa backend/ CHỈ để áp docs/patch-dau-tu.md, trên nhánh riêng.
Thứ tự bắt buộc: sửa class-fin-personal.php TRƯỚC, nâng version SAU.
Sau khi áp: chạy SHOW COLUMNS xác nhận varchar(10), kiểm gdsfin_db_version = 1.9.0,
in bảng đối chiếu kỳ vọng vs thực tế trên bảng THẬT.
KHÔNG được làm đổi số fin/summary với dữ liệu cũ (10 bản ghi hiện có).
