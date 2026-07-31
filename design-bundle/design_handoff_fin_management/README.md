# Handoff: FIN MANAGEMENT (FM) — Website quản lý tài chính, cổ phiếu & trading (thị trường Việt Nam)

## Overview
FM (FIN MANAGEMENT), viết bởi TUNGVN — version 1.0.0 — là một ứng dụng web desktop một người dùng để quản lý danh mục cổ phiếu, sổ giao dịch (theo cơ chế T+2 của thị trường Việt Nam), tài chính cá nhân (thu/chi), checklist mua/bán, và nhật ký cảm nhận thị trường. Giao diện tiếng Việt, có 2 nền (Sáng/Tối) chuyển tại chỗ. Toàn bộ dữ liệu lưu ở trình duyệt (localStorage), phiên đăng nhập ở sessionStorage.

## About the Design Files
Các file trong bundle này là **tài liệu thiết kế tham chiếu được tạo bằng HTML** — một prototype thể hiện giao diện và hành vi mong muốn, **không phải mã production để copy trực tiếp**. Nhiệm vụ của lập trình viên là **tái hiện các thiết kế HTML này trong môi trường/codebase mục tiêu** (React, Vue, v.v.) theo pattern và thư viện sẵn có của codebase đó. Nếu chưa có codebase, hãy chọn framework phù hợp nhất (khuyến nghị React + Vite) và triển khai lại.

Prototype được xây dựng bằng một runtime "Design Component" nội bộ (`support.js`) — đây chỉ là công cụ để prototype chạy được trong trình duyệt, **không cần** mang sang codebase thật. Logic nghiệp vụ (tính lãi/lỗ, T+2 FIFO, phí/thuế, thống kê thu chi) nằm trong class `Component` ở cuối file `VNInvest.dc.html` và là phần đáng giá nhất để đọc và port.

## Fidelity
**High-fidelity (hifi)**. Màu sắc, typography, spacing, bo góc và tương tác đã ở mức gần cuối. Hãy tái hiện pixel-perfect bằng thư viện/design-system của codebase đích. Mọi giá trị màu và token được liệt kê ở mục Design Tokens.

## Kiến trúc chung
- **Layout gốc**: grid 2 cột — sidebar cố định `236px` + vùng main (`grid-template-columns: 236px 1fr`), chiều cao `100vh`, `overflow: hidden`. Main gồm topbar (đứng yên) + vùng nội dung `overflow-y: auto`.
- **Điều hướng**: state `screen` chọn 1 trong các màn. Sidebar liệt kê các mục; mục đang chọn có nền `--accentSoft`, chữ `--accentInk`.
- **Cổng đăng nhập**: khi chưa đăng nhập, chỉ hiện màn Login; khi `authed` mới hiện app.
- **Chuẩn màu VN**: xanh = tăng/thu (`--up`), đỏ = giảm/chi (`--down`); số dùng font mono (`IBM Plex Mono`).
- **Tiền tệ**: đa số ô nhập theo **nghìn ₫** (ví dụ nhập `5.000` = 5 triệu). Định dạng số kiểu VN: dấu `.` ngăn cách nghìn, dấu `,` thập phân, dấu trừ là `−`.

## Screens / Views

### 1. Login (cổng đăng nhập)
- **Purpose**: chặn truy cập app tới khi đăng nhập.
- **Layout**: card `380px` canh giữa màn hình, nền có radial-gradient `--accentSoft`. Card `border-radius: 20px`, padding `32px`, shadow `0 30px 60px -25px rgba(0,0,0,.3)`.
- **Components**: logo `V` (36×36, bo `10px`, nền `--accent`) + tên "VNInvest"; ô Tên đăng nhập; ô Mật khẩu (type password, Enter để submit); dòng lỗi đỏ khi sai; nút "Đăng nhập" full-width nền `--accent`.
- **Thông tin đăng nhập**: user `mngt` / mật khẩu `mngt` (mật khẩu có thể đổi trong Cài đặt; lưu ở localStorage). Đây chỉ là auth demo phía client, **không phải bảo mật thật** — codebase thật cần backend auth.
- **Lưu ý tên hiển thị**: tiêu đề app cũ vẫn là "VNInvest" ở login/sidebar, nhưng tên phần mềm chính thức là **FIN MANAGEMENT (FM)** (xem mục About trong Cài đặt). Khi port, thống nhất dùng FM.

### 2. Tổng quan (overview)
- **Purpose**: bảng điều khiển tổng hợp.
- **Layout**: cột dọc, gap `16px`.
  - 4 thẻ KPI (`grid` 4 cột): Tổng tài sản (thẻ hero, nền `--heroBg`, chữ `--heroFg`), Lãi/lỗ hôm nay, Tiền mặt khả dụng, Cổ tức dự kiến/năm.
  - Hàng 2 (`grid 1.6fr 1fr`): biểu đồ đường "Giá trị danh mục" (SVG area, gradient `--accent`) + "Phân bổ theo ngành" (thanh ngang).
  - Dải "Gợi ý phát hiện cổ phiếu tốt" nền `--accentSoft`, có nút "Mở Bộ lọc →".
  - **3 ô digest** (`grid 1fr 1fr`, ô vĩ mô chiếm 2 hàng): 🌐 Tóm tắt vĩ mô (giá vàng SJC, dầu Brent, USD/VND, DXY, lãi liên ngân hàng, OMO), 📰 Tin vĩ mô tác động (nhãn Tốt/Xấu/Trung tính), 📌 Tin cổ phiếu trong danh mục. Cả 3 gắn nhãn "Cập nhật 08:30 / 14:00" theo phiên gần nhất trong ngày.
  - Bảng "Danh mục nắm giữ" — **lấy từ sổ giao dịch** (chỉ mã còn KL > 0): Mã, KL, Giá vốn TB (gồm phí), Giá TT, Giá trị, Lãi/lỗ %, sparkline 7 ngày.
- **Quan trọng**: ô "Tin cổ phiếu trong danh mục" chỉ hiển thị các mã **thực sự đang nắm giữ** (suy ra từ ledger), không hard-code.

### 3. Bảng giá (board)
- Tab lọc VN30 / HOSE / HNX / Tất cả. Bảng giá: Mã + tên, Trần (tím `oklch(0.62 0.15 300)`), Sàn (xanh lam), TC, Khớp, +/−, %, KL. Màu Khớp/+/−/% theo tăng (xanh) / giảm (đỏ) / tham chiếu (vàng-xám `oklch(0.7 0.03 80)`).

### 4. Giao dịch (trade) — **sổ nhật ký giao dịch + tính lãi/lỗ**
- **Purpose**: nhập từng lệnh mua/bán, phần mềm tự tính. Đây vừa là giao dịch thực tế vừa là kế hoạch.
- **3 thẻ tổng hợp**: (1) Tổng lãi/lỗ đã thực hiện — số lớn đổi màu: **vàng** khi hòa vốn, **xanh** khi lãi, **đỏ** khi lỗ; kèm 2 dòng nhỏ Tổng mua ròng + Tổng bán ròng. (2) Số mã đang nắm giữ. (3) Tổng phí + thuế.
- **Form nhập giao dịch mới**: Mã CP · **Loại (MUA/BÁN)** · **Ngày thực hiện** (date) · Khối lượng · Giá (nhãn đổi theo mua/bán) → nút "+ Thêm".
- **Bảng "Tổng hợp theo mã"**: Mã, KL còn lại, Giá vốn TB, **Giá trị ròng** (KL còn × giá vốn TB), Đã bán, Lãi/lỗ thực hiện (₫ + %). Màu xanh/đỏ.
- **Bảng "Diễn tiến giao dịch theo T+2"**: mỗi dòng hiển thị trạng thái "Hàng về [ngày]" (mua) hoặc "✓ Hàng đã về" / "⚠ Chỉ N cp đã về (T+2)" (bán), dòng tiền ròng, lãi/lỗ dòng, **lãi/lỗ lũy kế**, còn nắm. Chân bảng: "Đã bán sạch — lãi/lỗ cuối cùng" + số tiền, hoặc số còn nắm.
- **Bảng "Lịch sử giao dịch"**: ngày, mã, loại (badge xanh MUA / đỏ BÁN), giá, giá sau phí/thuế, giá trị ròng, nút xóa.

### 5. Tài chính cá nhân (finance) — **quản lý thu/chi**
- **Bộ lọc** Năm / Tháng (mặc định năm & tháng mới nhất có dữ liệu).
- **5 thẻ thống kê**: Thu tháng, Chi tháng, Thu năm, Chi năm, Dòng tiền ròng năm (thẻ hero).
- **Biểu đồ 12 tháng**: mỗi tháng 2 cột liền nhau — thu (xanh) và chi (đỏ); cột tháng đang chọn tô đậm.
- **Chi tiêu theo loại** (năm): thanh ngang %, màu theo danh mục.
- **Form nhập**: chọn **Thu/Chi** (Thu→xanh, Chi→đỏ) · Ngày · Số tiền (nghìn ₫) · Ghi chú · **Loại thu/chi** (dropdown đổi theo Thu/Chi) → "+ Thêm".
- **Sổ thu chi**: mới nhất trên đầu, số tiền xanh (+) / đỏ (−), badge loại có màu, nút xóa.
- Danh mục CHI: Mua sắm, Đồ dùng thiết yếu, Đầu tư, Ăn uống, Di chuyển, Hóa đơn, Khác. Danh mục THU: Lương, Thưởng, Cổ tức, Kinh doanh, Khác.

### 6. Phân tích (analysis)
- Biểu đồ giá + MA50 (SVG), bảng chỉ báo RSI/MACD/MA20-MA50/Khối lượng, và thẻ "Tín hiệu tổng hợp" (MUA — Tích cực) nền `--upSoft`.

### 7. Bộ lọc cổ phiếu (screener) — "phát hiện cổ phiếu tốt"
- Các chip tiêu chí bật/tắt: P/E < 20, ROE > 15%, Tăng LN > 20%, Dòng tiền dương, Cổ tức đều, Thanh khoản cao.
- Bảng kết quả có cột **Điểm** (x/số tiêu chí bật, badge màu theo tỉ lệ đạt: ≥0.8 xanh, ≥0.5 vàng, còn lại đỏ), P/E, ROE, Tăng LN, Dòng tiền, Khuyến nghị. Tự xếp hạng theo điểm.

### 8. Checklist mua/bán (checklist)
- **Header**: Mã CP · Khuyến nghị (Mua/Bán/Theo dõi, đổi màu) · VN-Index · Thời điểm đánh giá (**chỉ đọc**, đóng dấu khi bấm "✓ Hoàn thành") · Giá mua · Giá bán dự kiến · Ngày bán dự kiến. Góc phải: số tiêu chí Đạt + nút "✓ Hoàn thành".
- **Bảng checklist**: mục 1–8 (Phân tích cơ bản, Định giá, Xu hướng, Vĩ mô, Nhóm ngành, Cổ tức, Triển vọng, Rủi ro) và nhóm **9 Điểm mua** (dải xanh) / **10 Điểm bán** (dải đỏ) với các tiêu chí con (RSI, Điểm %, Volume, Phân kỳ, Đáy/Đỉnh, BB, Thời gian xu hướng, Thời gian giảm liên tục, Tâm lý). Mỗi dòng: ô "Đánh giá của bạn" + nút trạng thái **Đạt / Chưa / N/A** + cột Giải thích & Ghi chú. Nội dung giải thích/ghi chú đầy đủ nằm trong mảng `checklistDefs`.

### 9. Nhật ký thị trường (journal)
- **Ô ghi nhận ở trên**: chọn **Cảm nhận** (🤑 Hưng phấn / 😀 Lạc quan / 😐 Trung tính / 😟 Thận trọng / 😱 Hoảng loạn) · **Gắn cờ** (🚩 Cảnh báo / 🟡 Bài học / 🟢 Cơ hội / 🔵 Ghi nhớ / Không) · VN-Index (tùy chọn) · textarea ghi chú → "Lưu nhật ký".
- **Danh sách ở dưới**: **mới nhất trên cùng**; bộ lọc theo **Năm / Tháng / Cờ**. Mỗi mục: icon cảm nhận + badge, badge cờ, VN-Index, ngày giờ tự đóng dấu, nút xóa. Có sẵn dữ liệu import 14 ghi chép mẫu (seed một lần).

### 10. Cài đặt (settings)
- **Thông tin cá nhân**: Tên, Công ty CK, Số tài khoản.
- **Đổi mật khẩu**: mật khẩu hiện tại → mới (tối thiểu 4 ký tự) → xác nhận; báo trạng thái xanh/đỏ.
- **Biểu phí & thuế theo thời gian**: danh sách các mốc hiệu lực (ngày, phí mua %, phí bán %, thuế %) + form thêm mốc mới. **Khi tính toán, mỗi giao dịch dùng biểu phí có hiệu lực tại ngày giao dịch đó** (hàm `rateFor(date)` chọn mốc mới nhất ≤ ngày).
- **About** (cuối trang): logo **FM**, "FIN MANAGEMENT (FM)", dòng "About this software: Written by TUNGVN · version 1.0.0".

## Interactions & Behavior
- **Chuyển nền Sáng/Tối**: nút ở topbar (🌙 Nền Tối / ☀️ Nền Sáng) đổi `theme`, ghi đè toàn bộ CSS custom properties.
- **Điều hướng**: click mục sidebar đổi `screen`. Một số nút nội dung điều hướng chéo (ví dụ "Mở Bộ lọc →" → screener; "Xem bảng giá →" → board).
- **T+2**: `addTradingDays(iso, 2)` cộng 2 ngày làm việc (bỏ T7/CN), dùng ngày **giờ địa phương VN** (không dùng `toISOString` để tránh lệch UTC).
- **Khớp lãi/lỗ**: FIFO — bán khớp vào lô mua sớm nhất đã "về" trước; nếu bán quá số đã về thì cảnh báo.
- **Lãi/lỗ thực hiện** = tiền bán ròng (sau phí bán + thuế) − giá vốn bình quân phần đã bán (giá mua đã gồm phí mua).
- **Digest vĩ mô/tin**: nhãn phiên tính theo giờ hiện tại (≥14:00 → phiên 14:00; ≥08:30 → 08:30; trước đó → phiên 14:00 hôm trước). Dữ liệu hiện là **mẫu**; codebase thật cần nối API giá vàng/dầu/tỉ giá/tin tức, cập nhật 2 lần/ngày (08:30 và 14:00).
- **Xác thực form**: các form bỏ qua khi thiếu trường bắt buộc (mã/KL/giá/ngày/số tiền).
- Không có animation phức tạp; chủ yếu là đổi state + đổi màu.

## State Management
State chính (đều persist trừ khi ghi chú khác):
- `theme` ('light'|'dark') — không persist (mặc định light).
- `screen` — màn đang xem (không persist).
- `authed` (sessionStorage `vninvest_auth`), `login` (tạm), `password` (localStorage).
- `txns[]` — sổ giao dịch cổ phiếu `{sym, type:'buy'|'sell', date:'YYYY-MM-DD', qty, price}` (price theo nghìn ₫).
- `rates[]` — biểu phí/thuế theo mốc `{date, buyFee, sellFee, tax}` (%).
- `fin[]` — thu/chi `{type:'in'|'out', amount (₫), cat, note, date}`.
- `journal[]` — `{mood, vnindex, text, flag, at:'DD/MM/YYYY HH:MM'}`.
- `clHead` + `clRows{}` — checklist header và trạng thái từng dòng.
- `profile` — `{name, broker, account}`.
- Các `*Draft`, `*View`, `*Filter` — state tạm cho form/bộ lọc (không persist).
- **Persistence**: `localStorage['vninvest_v1']` = JSON `{txns, profile, rates, password, clHead, clRows, journal, fin}`; nạp trong `componentDidMount`, ghi trong `componentDidUpdate`. Có 2 cờ chạy-một-lần: `vninvest_journal_import_v1` (seed nhật ký), `vninvest_pw_reset_mngt` (reset mật khẩu về mngt).
- **Hằng số phí/thuế mặc định**: phí mua 0,15%, phí bán 0,15%, thuế bán 0,10% (`BUY_FEE/SELL_FEE/TAX`, và biểu `rates` theo mốc thời gian ghi đè).

## Design Tokens
Toàn bộ token là CSS custom properties, đổi theo theme (xem object `themes` trong logic class).

**Light**: `--bg #faf9f7` · `--panel #ffffff` · `--panel2 #f6f4f0` · `--sidebar #ffffff` · `--border #eceae6` · `--border2 #f4f2ee` · `--fg #18181b` · `--sub #3f3f46` · `--muted #71717a` · `--muted2 #a1a1aa` · `--chip #e4e4e7` · `--accent oklch(0.54 0.16 265)` · `--accentSoft oklch(0.95 0.03 265)` · `--accentInk oklch(0.45 0.16 265)` · `--up oklch(0.55 0.15 150)` · `--down oklch(0.58 0.19 25)` · `--upSoft oklch(0.96 0.04 150)` · `--downSoft oklch(0.96 0.05 25)` · `--heroBg oklch(0.54 0.16 265)` · `--heroFg #ffffff`.

**Dark**: `--bg #0e1117` · `--panel #12161f` · `--panel2 #0e1117` · `--sidebar #12161f` · `--border #1f2430` · `--border2 #1a1f2b` · `--fg #f4f4f5` · `--sub #c4c9d4` · `--muted #8b93a1` · `--muted2 #6b7280` · `--chip #1f2430` · `--accent oklch(0.78 0.12 180)` · `--accentSoft rgba(45,212,191,.13)` · `--accentInk oklch(0.84 0.12 180)` · `--up oklch(0.78 0.15 150)` · `--down oklch(0.68 0.19 25)` · `--upSoft rgba(52,211,153,.12)` · `--downSoft rgba(248,113,113,.1)` · `--heroBg linear-gradient(135deg, oklch(0.72 0.13 180), oklch(0.6 0.13 200))` · `--heroFg #04211d`.

**Màu phụ**: trần `oklch(0.62 0.15 300)`, sàn/xanh-lam `oklch(0.6 0.14 200)`, tham chiếu `oklch(0.7 0.03 80)`. Màu danh mục chi tiêu: Mua sắm `oklch(0.62 0.15 300)`, Đồ dùng thiết yếu `oklch(0.6 0.14 200)`, Đầu tư `--accent`, Ăn uống `oklch(0.7 0.14 60)`, Di chuyển `oklch(0.65 0.13 160)`, Hóa đơn `oklch(0.6 0.14 30)`, Khác `--muted2`.

**Typography**: heading/UI = **Manrope** (400–800); số liệu = **IBM Plex Mono** (400–600, `font-feature-settings:'tnum'`). Cỡ chữ chính: KPI number 22–25px/700; tiêu đề section 14px/700; nhãn 11–12px/600; body 13–14px; label form 11px.

**Bo góc**: thẻ `16px`, card lớn `20px`, nút/input `10–11px`, badge/pill `20px`, ô nhỏ `6–8px`. **Shadow**: card nổi/login `0 30px 60px -20~-25px rgba(0,0,0,.25~.5)`. **Spacing**: gap chính `14–16px`, padding thẻ `18px`, padding card lớn `20px`.

## Assets
- Fonts: Google Fonts — Manrope, IBM Plex Mono (link trong `<helmet>`).
- Không dùng ảnh/icon ngoài; biểu tượng dùng emoji (🌐 📰 📌 💡 🚩 🟡 🟢 🔵 😀 😐 😟 😱 🤑 🌙 ☀️) và ký tự (✕ ⎋ ✓ →). Biểu đồ là SVG tự vẽ. Sparkline/nến/cột là SVG inline.
- Không có tài sản thương hiệu bên thứ ba.

## Screenshots
Thư mục `screenshots/` chứa ảnh chụp **trọn trang** (full page, thu nhỏ vừa khung) của từng màn, theme Sáng: `01-tong-quan`, `02-bang-gia`, `03-giao-dich`, `04-tai-chinh-ca-nhan`, `05-phan-tich`, `06-bo-loc`, `07-checklist`, `08-nhat-ky`, `09-tin-tuc`, `10-cai-dat`. Màn Login không kèm ảnh (được chụp ở trạng thái đã đăng nhập).

## Files
- `VNInvest.dc.html` — prototype đầy đủ: template (markup, giữa `<x-dc>…</x-dc>`) + logic class `Component` (state, tính toán, handlers) + metadata props ở cuối. Đây là nguồn tham chiếu chính; đọc class `Component` để nắm toàn bộ công thức nghiệp vụ (T+2 FIFO, phí/thuế theo mốc, thống kê thu chi, chấm điểm screener).
- `support.js` — runtime nội bộ chỉ để prototype chạy trong trình duyệt. **Không cần** port sang codebase thật.

## Gợi ý triển khai
- Khuyến nghị React + TypeScript; tách mỗi màn thành 1 route/component; đưa state persistent vào 1 store (Zustand/Redux) với middleware localStorage.
- Thay auth demo bằng auth thật (backend) — không giữ mật khẩu ở client.
- Nối dữ liệu thật: bảng giá realtime, giá vàng/dầu/tỉ giá/DXY/OMO, tin tức (2 phiên/ngày). Prototype đang dùng dữ liệu mẫu.
- Định dạng số/tiền nên tách thành util dùng chung (kiểu VN: `.` nghìn, `,` thập phân, `−` cho số âm).
