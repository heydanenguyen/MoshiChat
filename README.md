# Unison

Mọi cuộc trò chuyện, một nơi duy nhất. Unison gom **Messenger, Instagram, Telegram, Zalo và WhatsApp** vào một hộp thư desktop với giao diện chuẩn Apple HIG: bố cục ba cột, vibrancy/Mica, bong bóng tin nhắn kiểu Messages.app, dark mode, ⌘K, reply, reaction, đính kèm và tìm kiếm nội dung tin nhắn.

## Chạy thử

```bash
npm install
npm run dev
```

Lần đầu mở app, bấm **Dùng thử với dữ liệu mẫu** để xem toàn bộ trải nghiệm (typing indicator, auto-reply, read receipt, badge chưa đọc, reply, reaction, đính kèm) trên cả năm nền tảng mà không cần tài khoản thật.

Build gói cài đặt: `npm run dist` (Windows NSIS, macOS DMG, Linux AppImage). Icon được sinh bằng `node scripts/make-icon.mjs`.

## Kết nối tài khoản thật

| Nền tảng | Cách kết nối | Cần gì | Reply / Reaction / Đính kèm |
| --- | --- | --- | --- |
| **Telegram** | MTProto qua [gramjs](https://gram.js.org), đăng nhập như Telegram Desktop (SĐT → mã → mật khẩu 2 lớp). Real-time, đầy đủ lịch sử, ảnh, sticker, reaction, read receipt, typing. | `API ID` + `API Hash` tạo tại <https://my.telegram.org/apps> | ✓ / ✓ / ✓ |
| **WhatsApp** | Giao thức WhatsApp Web multi-device qua [Baileys](https://github.com/WhiskeySockets/Baileys). Quét QR trong WhatsApp → *Thiết bị đã liên kết*, giống WhatsApp Desktop. Lịch sử đồng bộ từ điện thoại trong phút đầu. | Chỉ cần điện thoại để quét QR | ✓ / ✓ / ✓ |
| **Zalo** | Giao thức Zalo Web qua [zca-js](https://github.com/RFS-ADRENO/zca-js). Quét QR trong app Zalo, giống chat.zalo.me. | Chỉ cần điện thoại để quét QR | ✓ / ✓ (7 cảm xúc Zalo) / ✓ |
| **Messenger** | Meta Graph API (Messenger Platform) cho **Fanpage**. Polling 8 giây, gửi/nhận text + ảnh + file, mark seen, typing. | `Page ID` + `Page Access Token` có quyền `pages_messaging`, `pages_manage_metadata` | ✗ / ✗ / ✓ |
| **Instagram** | Instagram Messaging API cho tài khoản **Professional** đã liên kết Fanpage. | Page token có thêm `instagram_basic`, `instagram_manage_messages` | ✗ / ✗ / ✓ |

> **Lưu ý về tài khoản cá nhân.** Meta không có API chính thức cho tin nhắn cá nhân Facebook/Instagram nên Unison chỉ hỗ trợ Page / Professional bằng API chính thức. WhatsApp và Zalo cũng không có API cá nhân chính thức; Unison dùng đúng giao thức web mà ứng dụng desktop của họ dùng (Baileys, zca-js). Đây là giải pháp phổ biến (Beeper, Texts.com dùng cách tương tự) nhưng không được nhà cung cấp bảo chứng, hãy dùng có chừng mực và tránh gửi hàng loạt để không bị hạn chế tài khoản.

Token, session và cookie được mã hoá bằng `safeStorage` của Electron (DPAPI trên Windows, Keychain trên macOS) trước khi ghi xuống `%APPDATA%/unison/unison.json`. Khoá Signal của WhatsApp nằm trong `%APPDATA%/unison/adapters/whatsapp/`.

## Tính năng

- Hộp thư hợp nhất, lọc theo nền tảng hoặc tài khoản, badge chưa đọc, ghim, tắt thông báo
- Bong bóng gom nhóm theo người gửi, ngăn cách ngày, trạng thái Đã gửi/Đã xem, typing indicator
- Reply (quote), reaction nhanh (❤️ 👍 😂 😮 😢 🙏), đính kèm qua nút kẹp giấy, kéo-thả hoặc dán ảnh
- Tìm hội thoại và **tìm trong nội dung tin nhắn**, nhảy tới tin và highlight
- ⌘K command palette, thông báo hệ thống, dark/light/system, Tiếng Việt/English

## Kiến trúc

```
src/
  shared/      types.ts (domain model), bridge.ts (IPC contract)
  main/        index.ts (window, IPC, notifications, file picker), storage.ts (encrypted store)
    adapters/  types.ts (PlatformAdapter interface), manager.ts (AccountManager, cache, search, QR auth)
               telegram.ts (MTProto), whatsapp.ts (Baileys), zalo.ts (zca-js),
               meta.ts (Graph API), demo.ts (sample data)
  preload/     contextBridge → window.unison
  renderer/    React + Zustand
    components/ Sidebar, ConversationList, ChatView, Composer, DetailsPane,
                SettingsSheet, AddAccountSheet, AuthPromptSheet (phone/code/password/QR), CommandPalette
    styles/     tokens.css (design tokens light/dark), app.css
scripts/make-icon.mjs   sinh icon app (build/icon.png, resources/icon.png)
```

Mỗi nền tảng là một `PlatformAdapter` (connect, listConversations, fetchMessages, sendMessage với reply/đính kèm, markRead, setTyping, react) và đẩy sự kiện (`message:new`, `message:updated`, `typing`, `conversation:upserted`, `auth:prompt`…) về renderer qua một kênh IPC duy nhất. `Account.features` cho biết nền tảng hỗ trợ reply/react/đính kèm để UI ẩn nút không dùng được. Thêm nền tảng mới = thêm một adapter.

## Phím tắt

- `Ctrl/⌘ K` – nhảy nhanh đến hội thoại
- `Ctrl/⌘ ,` – cài đặt
- `Enter` gửi, `Shift+Enter` xuống dòng (đổi được trong cài đặt), `Esc` huỷ reply / đóng sheet
