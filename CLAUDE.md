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
- UI quy đổi khi hiển thị: chia 1e6 ra "tr"; định dạng VN (. nghìn, , thập phân, − âm)
- Form nhập theo NGHÌN ₫ (gõ 5.000 = 5 triệu), nhân 1000 trước khi gửi API
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
- GET    fin/categories        -> { in:[...], out:[...] }
- GET    fin/entries           -> [{id, entry_type, amount, cat, note, entry_date}]
- POST   fin/entries           body {entry_type:'in'|'out', amount(đồng, chuỗi), cat, note, entry_date}
- DELETE fin/entries/{id}
- GET    fin/summary?year=YYYY -> {year, years[], monthly[12]{in,out}, catTotals{}, inYear, outYear, net}

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

Lưu ý khi dựng UI Giao dịch: backend đã tính sẵn lãi/lỗ, client KHÔNG tự tính.
footer trả CẢ HAI số — cum_pl (engine FIFO, dùng cho chân bảng timeline) và
total_realized (engine bình quân, dùng cho thẻ đầu màn) — kèm engines_diverge;
khi engines_diverge=true PHẢI hiện cảnh báo, không được giấu.

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

## Nới phạm vi tạm thời — chỉ để áp dụng api-spec
Được sửa backend/ CHỈ để cài đặt docs/api-spec.md, trên nhánh riêng.
Bắt buộc: chạy VD1–VD4 mục 4, in bảng đối chiếu "kỳ vọng vs thực tế"
cho từng chỉ số. Không báo hoàn thành nếu còn dòng nào lệch.
KHÔNG đụng class-fin-personal.php và các endpoint fin/entries hiện có.
Ba số test trước tiên: total_fees=600000 (VD4), engines_diff=50075000 (VD2),
t2_avail=0 nhưng row_pl=9575000 (VD3).
