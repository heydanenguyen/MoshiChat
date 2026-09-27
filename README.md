# Moshi

Mọi cuộc trò chuyện, một nơi duy nhất. Moshi gom **Messenger, Instagram, Telegram, Zalo và WhatsApp** vào một hộp thư desktop với giao diện chuẩn Apple HIG: bố cục ba cột, vibrancy/Mica, bong bóng tin nhắn kiểu Messages.app, dark mode, ⌘K, reply, reaction, chuyển tiếp, voice note, đính kèm và tìm kiếm nội dung tin nhắn.

## Chạy thử

```bash
npm install
npm run dev        # chạy bản phát triển
npm test           # unit test (vitest)
npm run dist       # đóng gói: Windows NSIS, macOS DMG, Linux AppImage → dist/
```

Lần đầu mở app, bấm **Dùng thử với dữ liệu mẫu** để xem toàn bộ trải nghiệm (typing indicator, auto-reply, read receipt, badge chưa đọc, reply, reaction, chuyển tiếp, voice, đính kèm) trên cả năm nền tảng mà không cần tài khoản thật.

Icon được sinh bằng `node scripts/make-icon.mjs` (không cần thư viện native).

## Kết nối tài khoản thật

| Nền tảng | Cách kết nối | Cần gì | Reply / Reaction / Đính kèm / Voice / Forward |
| --- | --- | --- | --- |
| **Telegram** | MTProto qua [gramjs](https://gram.js.org), đăng nhập như Telegram Desktop (SĐT → mã → mật khẩu 2 lớp). Real-time, đầy đủ lịch sử, ảnh, sticker, reaction, read receipt, typing, **tìm kiếm phía máy chủ** toàn bộ lịch sử. | `API ID` + `API Hash` tạo tại <https://my.telegram.org/apps> | ✓ / ✓ / ✓ / ✓ voice note / ✓ native |
| **WhatsApp** | Giao thức WhatsApp Web multi-device qua [Baileys](https://github.com/WhiskeySockets/Baileys). Quét QR trong WhatsApp → *Thiết bị đã liên kết*, giống WhatsApp Desktop. Lịch sử đồng bộ từ điện thoại trong phút đầu. | Điện thoại để quét QR | ✓ / ✓ / ✓ / ✓ push-to-talk / ✓ native |
| **Zalo** | Giao thức Zalo Web qua [zca-js](https://github.com/RFS-ADRENO/zca-js). Quét QR trong app Zalo, giống chat.zalo.me. | Điện thoại để quét QR | ✓ / ✓ (7 cảm xúc) / ✓ / gửi dạng tệp / ✓ văn bản |
| **Facebook cá nhân** | Giao thức Messenger web qua [ws3-fca](https://www.npmjs.com/package/ws3-fca). Bấm *Tài khoản cá nhân*, đăng nhập facebook.com ngay trong cửa sổ app, Moshi chỉ giữ cookie phiên. Thread list, lịch sử, gửi/nhận real-time (MQTT), typing, seen, reaction. Beta. | Đăng nhập trong app | ✓ / ✓ / ✓ / gửi dạng tệp / ✓ văn bản |
| **Instagram cá nhân** | Giao thức web của instagram.com trong phiên đăng nhập của app: đọc qua cùng các địa chỉ trang web dùng, gửi bằng chính khung soạn của Instagram trong một cửa sổ ẩn. Real-time, ảnh, voice, link, bài chia sẻ, reaction hiển thị. Beta. | Đăng nhập trong app | ✗ / ✗ / ảnh / ✗ / ✓ văn bản |
| **Messenger** | Meta Graph API (Messenger Platform) cho **Fanpage**. Có thể bấm *Đăng nhập với Facebook* (cần App ID) để chọn Page thay vì nhập token. Polling 8 giây, gửi/nhận text + ảnh + file, mark seen, typing. | `Page ID` + `Page Access Token` có quyền `pages_messaging`, `pages_manage_metadata` | ✗ / ✗ / ✓ / gửi dạng tệp / ✓ văn bản |
| **Instagram** | Instagram Messaging API cho tài khoản **Professional** đã liên kết Fanpage. | Page token có thêm `instagram_basic`, `instagram_manage_messages` | ✗ / ✗ / ✓ / gửi dạng tệp / ✓ văn bản |

Chuyển tiếp trong cùng tài khoản dùng cơ chế native của nền tảng (giữ ảnh, nguồn gốc). Chuyển tiếp sang tài khoản/nền tảng khác chỉ mang theo phần văn bản.

> **Lưu ý về tài khoản cá nhân.** Meta không có API chính thức cho tin nhắn cá nhân Facebook/Instagram nên Moshi chỉ hỗ trợ Page / Professional bằng API chính thức. WhatsApp và Zalo cũng không có API cá nhân chính thức; Moshi dùng đúng giao thức web mà ứng dụng desktop của họ dùng (Baileys, zca-js). Đây là giải pháp phổ biến (Beeper, Texts.com dùng cách tương tự) nhưng không được nhà cung cấp bảo chứng, hãy dùng có chừng mực và tránh gửi hàng loạt để không bị hạn chế tài khoản.

Token, session và cookie được mã hoá bằng `safeStorage` của Electron (DPAPI trên Windows, Keychain trên macOS) trước khi ghi xuống `%APPDATA%/Moshi/unison.json`. Khoá Signal của WhatsApp nằm trong `%APPDATA%/Moshi/adapters/whatsapp/`.

## Voice note không cần ffmpeg

Chromium chỉ ghi âm ra WebM/Opus, còn Telegram và WhatsApp muốn Ogg/Opus để hiển thị dạng voice note. `src/main/media/webm-to-ogg.ts` đọc EBML, lấy nguyên các gói Opus và đóng lại thành Ogg (kèm CRC, granule position), nên không cần ffmpeg hay WASM. Có test riêng cho bộ remux này.

## Thiết kế

Nền mesh gradient pastel chuyển động chậm, ba cột là panel kính (backdrop blur) bo góc 22px nổi trên nền, font Plus Jakarta Sans đóng gói sẵn (8 subset, có tiếng Việt), bubble gửi đi gradient xanh-tím, pill nhãn pastel kiểu nhãn 3D mềm, thẻ thống kê màu kem/xanh/bạc hà. Liên hệ chưa có ảnh nhận **avatar trừu tượng** sinh bằng SVG (hình khối màu + khuôn mặt nhỏ trên đĩa đen), cố định theo tên nên mỗi người luôn cùng một nhân vật. Token ở `src/renderer/src/styles/tokens.css`, có bộ dark riêng.

## Tính năng

- Hộp thư hợp nhất, lọc theo nền tảng hoặc tài khoản, badge chưa đọc, ghim, tắt thông báo
- Bong bóng gom nhóm theo người gửi, ngăn cách ngày, trạng thái Đã gửi/Đã xem, typing indicator
- Reply (quote), reaction nhanh (❤️ 👍 😂 😮 😢 🙏), chuyển tiếp, ghi âm voice, đính kèm qua nút kẹp giấy, kéo-thả hoặc dán ảnh
- Trình phát voice ngay trong bong bóng, tải media theo yêu cầu
- Tìm hội thoại và **tìm trong nội dung tin nhắn** (cache cục bộ + tìm kiếm phía máy chủ Telegram), nhảy tới tin và highlight
- Pane chi tiết dạng tab cho từng người: thông tin (ảnh đại diện, bio, SĐT, sinh nhật, giới tính khi nền tảng cung cấp), thẻ "Trò chuyện" với ngày bắt đầu, thời gian đã trò chuyện, tổng số tin (Telegram lấy số thật từ máy chủ) và lần hoạt động gần nhất, tìm trong hội thoại, ảnh & video, liên kết, tài liệu; lightbox xem ảnh
- Gắn nhãn màu cho từng liên hệ (Công việc, Bạn thân, Người yêu, Gia đình, VIP, Vui vẻ): vòng màu quanh avatar, lọc theo nhãn ở thanh bên, chuột phải vào hội thoại để gắn nhanh
- Emoji picker (8 nhóm, tìm kiếm, gần đây), thanh bên thu gọn thành rail 64px, icon nền tảng chỉ hiện khi xem gộp nhiều nền tảng
- Soạn tin mới (⌘N hoặc nút bút): danh bạ gộp mọi tài khoản (Telegram contacts, WhatsApp, bạn bè Zalo, người từng nhắn Facebook/Instagram), lọc theo nền tảng, mở hoặc tạo hội thoại ngay
- Responsive: bubble và ảnh co theo bề rộng khung chat (container query), dưới 1180px pane chi tiết thành lớp phủ, dưới 980px thanh bên thành rail, dưới 720px một cột kiểu điện thoại với nút quay lại
- Cá nhân hoá trong Cài đặt: 6 bộ nền gradient (Bình minh, Đại dương, Kẹo ngọt, Rừng xanh, Oải hương, Tối giản), 6 màu nhấn, 4 font (Plus Jakarta Sans, Inter, Nunito, hệ thống)
- Tắt thông báo theo từng hội thoại (chuột phải hoặc công tắc ở tab Thông tin), theo nhãn, theo tài khoản (chuột phải ở thanh bên) hoặc theo nền tảng; badge chưa đọc cũng bỏ qua những gì đã tắt
- Thanh tiêu đề hiện câu chào vui xoay vòng mỗi 90 giây, gọi tên bạn, biết giờ trong ngày, số tin chưa đọc và thời tiết thật nơi bạn ở (Open-Meteo, định vị thô qua IP, không cần API key; tắt được trong Cài đặt)
- Thanh cuộn kiểu macOS: viên 4px chỉ hiện khi cuộn hoặc rê chuột
- Thanh tiêu đề mỏng kiểu mac ở mọi nền tảng: trên Windows app tự vẽ ba đèn giao thông thay cho nút hệ thống che nội dung
- ⌘K command palette, thông báo hệ thống, dark/light/system, Tiếng Việt/English

## Kiến trúc

```
src/
  shared/      types.ts (domain model), bridge.ts (IPC contract)
  main/        index.ts (window, IPC, notifications, file picker, voice), storage.ts (encrypted store)
    media/     webm-to-ogg.ts (remux voice note)
    adapters/  types.ts (PlatformAdapter interface), manager.ts (AccountManager, cache, search, forward, QR auth)
               telegram.ts (MTProto), whatsapp.ts (Baileys), zalo.ts (zca-js),
               meta.ts (Graph API), demo.ts (sample data)
  preload/     contextBridge → window.unison
  renderer/    React + Zustand
    components/ Sidebar, ConversationList, ChatView (+AudioPlayer), Composer (+recorder), DetailsPane,
                SettingsSheet, AddAccountSheet, AuthPromptSheet (phone/code/password/QR), CommandPalette, ForwardSheet
    styles/     tokens.css (design tokens light/dark), app.css
tests/         vitest: webm-to-ogg, demo adapter, AccountManager, Meta adapter (fetch giả lập), renderer utils
scripts/make-icon.mjs   sinh icon app (build/icon.png, resources/icon.png)
```

Mỗi nền tảng là một `PlatformAdapter` (connect, listConversations, fetchMessages, sendMessage với reply/đính kèm/voice, markRead, setTyping, react, forward, searchMessages, downloadAttachment) và đẩy sự kiện (`message:new`, `message:updated`, `typing`, `conversation:upserted`, `auth:prompt`…) về renderer qua một kênh IPC duy nhất. `Account.features` cho biết nền tảng hỗ trợ reply/react/đính kèm để UI ẩn nút không dùng được. Thêm nền tảng mới = thêm một adapter.

## Phím tắt

- `Ctrl/⌘ K` – nhảy nhanh đến hội thoại
- `Ctrl/⌘ ,` – cài đặt
- `Enter` gửi, `Shift+Enter` xuống dòng (đổi được trong cài đặt), `Esc` huỷ reply / đóng sheet

## Giấy phép

Trước phiên bản 0.2.0 ứng dụng tên là **Unison**. Bộ cài Moshi tự gỡ bản Unison cũ, và Moshi tự chuyển thư mục dữ liệu `%APPDATA%\Unison` sang `%APPDATA%\Moshi` ở lần mở đầu; tệp sao lưu `.unisonbackup` vẫn khôi phục được.

Moshi © 2026 Dane Nguyen, phát hành theo **GNU GPL v3 hoặc mới hơn** (xem `LICENSE`). Bạn được dùng, sửa và phân phối lại theo GPL. Tên **Moshi**, biểu tượng và bộ nhân vật là nhận diện riêng, không thuộc giấy phép: bản fork phải dùng tên và biểu tượng khác (GPL v3 §7e). Địa chỉ kho mã nguồn công khai sẽ được điền vào `resources/legal/NOTICE.md` trước khi phát hành bộ cài.

## Pháp lý và nền tảng

- Chỉ **Telegram** dùng API chính thức. Messenger, Instagram, Zalo và WhatsApp (tài khoản cá nhân) đi qua giao thức web không chính thức và **có thể trái điều khoản của nền tảng**; người dùng phải đọc và chấp nhận cảnh báo trong app trước khi kết nối. Không dùng Moshi để gửi hàng loạt.
- Điều khoản sử dụng, Chính sách riêng tư và danh sách giấy phép bên thứ ba nằm trong `resources/legal/` và hiện trong app tại *Cài đặt → Pháp lý*.
- Lưu ý giấy phép khi phân phối: Baileys kéo theo `libsignal` (GPL-3.0) và gramjs kéo theo `@cryptography/aes` (GPL-3.0-or-later). Bản phát hành kèm hai gói này cần phát hành mã nguồn Moshi theo giấy phép tương thích GPL-3.0. Mô hình dịch NLLB-200 là CC BY-NC 4.0 (phi thương mại).
