# Unison

Mọi cuộc trò chuyện, một nơi duy nhất. Unison gom **Messenger, Instagram, Telegram, Zalo và WhatsApp** vào một hộp thư desktop với giao diện chuẩn Apple HIG: bố cục ba cột, vibrancy/Mica, bong bóng tin nhắn kiểu Messages.app, dark mode, ⌘K, reply, reaction, chuyển tiếp, voice note, đính kèm và tìm kiếm nội dung tin nhắn.

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
| **Messenger** | Meta Graph API (Messenger Platform) cho **Fanpage**. Polling 8 giây, gửi/nhận text + ảnh + file, mark seen, typing. | `Page ID` + `Page Access Token` có quyền `pages_messaging`, `pages_manage_metadata` | ✗ / ✗ / ✓ / gửi dạng tệp / ✓ văn bản |
| **Instagram** | Instagram Messaging API cho tài khoản **Professional** đã liên kết Fanpage. | Page token có thêm `instagram_basic`, `instagram_manage_messages` | ✗ / ✗ / ✓ / gửi dạng tệp / ✓ văn bản |

Chuyển tiếp trong cùng tài khoản dùng cơ chế native của nền tảng (giữ ảnh, nguồn gốc). Chuyển tiếp sang tài khoản/nền tảng khác chỉ mang theo phần văn bản.

> **Lưu ý về tài khoản cá nhân.** Meta không có API chính thức cho tin nhắn cá nhân Facebook/Instagram nên Unison chỉ hỗ trợ Page / Professional bằng API chính thức. WhatsApp và Zalo cũng không có API cá nhân chính thức; Unison dùng đúng giao thức web mà ứng dụng desktop của họ dùng (Baileys, zca-js). Đây là giải pháp phổ biến (Beeper, Texts.com dùng cách tương tự) nhưng không được nhà cung cấp bảo chứng, hãy dùng có chừng mực và tránh gửi hàng loạt để không bị hạn chế tài khoản.

Token, session và cookie được mã hoá bằng `safeStorage` của Electron (DPAPI trên Windows, Keychain trên macOS) trước khi ghi xuống `%APPDATA%/Unison/unison.json`. Khoá Signal của WhatsApp nằm trong `%APPDATA%/Unison/adapters/whatsapp/`.

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
