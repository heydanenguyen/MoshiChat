# Gọi điện trong Moshi + Zalo relay — thiết kế (2026-10-10)

Chủ sở hữu duyệt: gọi điện mức 1 (khung Moshi, màn hình gọi của nền tảng bên trong) rồi mức 2 (nút điều khiển kiểu Moshi); nhận cuộc gọi đến; Zalo "cách 1" (relay luôn bật) rồi thử "cách 2" (giao thức đồng bộ của Zalo PC).

## 0. Sự thật nền (từ khảo sát code, 2026-10-10)
- Messenger cá nhân: có partition `persist:login-messenger[-id]` đang đăng nhập facebook.com (cookie `c_user`/`xs`); ws3-fca chạy ngoài window. Chưa code nào mở messenger.com; `www.facebook.com/messages/t/<id>` là đường an toàn. UA phải set bằng `browserUserAgent()`.
- Instagram cá nhân: partition `persist:login-instagram[-id]`; đã có window ẩn `/direct/inbox/` (`instagram-realtime.ts`, debugger Network) + `DirectComposer`. Không set UA (Electron mặc định). Gọi trên instagram.com web **chưa chắc có** → dò nút lúc chạy.
- Zalo: chỉ zca-js (cookie+imei+UA trong secret), không window nào mở chat.zalo.me. **Zalo chỉ cho 1 web session**: mở chat.zalo.me với cùng cookie → socket zca-js bị đóng mã 3000. Listener hiện coi 3000/3003 = đăng xuất nơi khác → `needs_auth`.
- Không có `setPermissionRequestHandler` nào; Electron mặc định cho phép media. macOS thiếu entitlement camera + chuỗi plist.
- Toast chỉ có 1 nút action, tự tắt 6 s → cuộc gọi đến cần component riêng.
- `AccountFeatures` ở `shared/types.ts:13-21`; renderer đọc `accounts[id].features`. Header chat: `ChatView.tsx` ~498-514 (`.chat-header-actions`).
- Zalo share hiện tại: `zalo-share.ts` ghi `<sync>/zalo-share/<owner>/<device>.zmsg` (AES-GCM+gzip, 21 ngày, tick 2 phút, ghi ≤ 5 phút/lần), chỉ tin thô; **máy đọc phải có session Zalo sống** (friends/groups từ `listConversations`). Sync settings (`sync.ts`) là last-writer-wins, không mang hàng đợi được.

## 1. Gọi điện — kiến trúc

### 1.1 Cửa sổ gọi (`src/main/calls/call-window.ts`)
- `BaseWindow` (frameless, 960×640, min 480×360, icon Moshi) chứa 2 `WebContentsView`:
  - **Khung Moshi** (`src/renderer/call.html`, entry thứ 2 của electron-vite renderer): thanh tiêu đề kéo được (avatar, tên, nền tảng, đồng hồ cuộc gọi, nút thu nhỏ/đóng), nền theo theme hiện tại (đọc `localStorage unison.splash` như Splash). Cao 44 px. IPC riêng `call-frame:*` (chỉ `end`, `minimize`, `state`).
  - **Trang nền tảng** (partition của tài khoản; `sandbox`, `contextIsolation`, không preload; `setWindowOpenHandler`: popup gọi của Facebook được **cho phép** và được gắn vào chính view này thay vì cửa sổ mới (`action:'allow'` + `overrideBrowserWindowOptions` → hoặc bắt `did-create-window` rồi chuyển content); mọi URL ngoài danh sách domain nền tảng → `shell.openExternal`).
- Một cửa sổ gọi tại một thời điểm (`CallManager` giữ `current`). Mở cuộc gọi mới khi đang gọi → hỏi kết thúc.
- Quyền media: `session.setPermissionRequestHandler` trên **mọi** partition: cho `media` (audio/video) chỉ khi origin ∈ {facebook.com, messenger.com, instagram.com, chat.zalo.me} và có cửa sổ gọi/incoming đang mở; từ chối còn lại; `setPermissionCheckHandler` tương ứng. Windows: không cần thêm; macOS: thêm `com.apple.security.device.camera` vào `build/entitlements.mac.plist`, cập nhật `NSCameraUsageDescription`/`NSMicrophoneUsageDescription`.

### 1.2 Bộ khởi động theo nền tảng (`src/main/calls/launchers/*.ts`)
Mỗi launcher: `start(account, conversation, kind: 'audio'|'video') → Promise<CallSession>`; `CallSession = { end(), onEnded }`.
- **Messenger** (`messenger.ts`): partition = `manager.storedPartition(id,'messenger')`, `ses.setUserAgent(browserUserAgent())`, load `https://www.facebook.com/messages/t/<fbThreadId>`; chờ DOM sẵn; bấm nút gọi (`[aria-label*="call" i]` thoại/video — chọn theo kind); nếu không tìm thấy trong 8 s → giữ trang, hiện gợi ý "Bấm nút gọi trên trang". Facebook mở cuộc gọi trong popup `/groupcall/` hoặc `messenger.com/call` → bắt bằng window-open handler như 1.1.
- **Instagram** (`instagram.ts`): partition tài khoản, UA `browserUserAgent()`, load `https://www.instagram.com/direct/t/<threadId>/`; dò nút gọi (`[aria-label*="call" i]`, `svg[aria-label*="Audio call" i|"Video call" i]`); kết quả dò được cache theo tài khoản (`features.call = 'none'` nếu 3 lần dò không thấy → renderer ẩn nút). Không thấy → thông báo "Instagram web không hỗ trợ gọi trên tài khoản này".
- **Zalo** (`zalo.ts`): partition `persist:zalo-call-<accountId>`; nạp cookie từ `credentials.cookie` (zca-js jar → `ses.cookies.set` từng cookie cho `.zalo.me`/`chat.zalo.me`), UA = `credentials.userAgent`; load `https://chat.zalo.me/`; chọn hội thoại (tìm theo tên qua ô search, hoặc theo id nếu URL hỗ trợ) → bấm gọi. **Bàn giao session**: trước khi load, `ZaloAdapter.pauseForCall()` → `listener.stop()`, trạng thái `connecting` + `error: 'call'` (renderer hiện "Đang gọi…" thay vì "Still connecting"), KHÔNG coi 3000 là đăng xuất khi `callActive`. Khi cửa sổ gọi đóng: xoá cookie của partition gọi (không xoá session server), `resumeAfterCall()` → `listener.start()` với backoff hiện có. Nếu sau resume vẫn 3000 ×3 → `needs_auth` như cũ.
- Thoát an toàn: `app.before-quit` đóng cửa sổ gọi (và resume Zalo không cần vì đang thoát).

### 1.3 Cuộc gọi đến (`src/main/calls/incoming.ts`)
- **Instagram**: script dò trong window ẩn realtime (`instagram-realtime.ts` đã có `executeJavaScript`): MutationObserver tìm dialog có nút `Answer`/`Decline` (aria-label/text, cả tiếng Việt "Trả lời"/"Từ chối"); phát `call:incoming {platform, accountId, callId, peerName, peerAvatar?, kind}`; Answer → hiện window ẩn thành cửa sổ gọi (mức 1: `BrowserWindow.show()` + đổi title/icon; khung Moshi chưa bọc được webContents có sẵn) rồi click Answer; Decline → click Decline. Hết chuông/kết thúc → `call:ended`.
- **Messenger**: window ẩn mới `messenger-presence` (partition tài khoản, UA, `https://www.facebook.com/messages/`, `backgroundThrottling:false`, audio **không** mute để nghe chuông; chặn ảnh/font như IG `blockHeavyResources`). Dò dialog chuông tương tự. Bật/tắt trong Settings → Calls ("Nhận cuộc gọi Messenger", mặc định bật khi có tài khoản Messenger cá nhân); tắt thì không tốn RAM.
- **Zalo**: không làm (xung đột session). Ghi rõ trong Settings: "Cuộc gọi Zalo đến vẫn đổ chuông trên điện thoại".
- Thông báo: `call:incoming` → renderer hiện `IncomingCallBanner` (góc trên phải, không tự tắt, Nghe/Từ chối, chuông nhẹ có thể tắt); Electron `Notification` click → focus Moshi + banner. App đang khoá → chỉ Notification + banner sau khi mở khoá.

### 1.4 IPC/kiểu (đặt trước để làm song song)
- `shared/types.ts`: `AccountFeatures.call?: 'audio' | 'video' | 'both' | 'none'`; `BridgeEvent` thêm `{ type: 'call:incoming'; call: IncomingCall } | { type: 'call:state'; state: CallState }` với `IncomingCall = { id, accountId, platform, peerName, peerAvatarUrl?, kind: 'audio'|'video', at: number }`, `CallState = { active?: { id, conversationId?, accountId, platform, kind, startedAt }, incoming: IncomingCall[] }`.
- `shared/bridge.ts` IPC: `calls:start (conversationId, kind)`, `calls:end (id)`, `calls:answer (id)`, `calls:decline (id)`, `calls:state ()`. Bridge `calls: { start, end, answer, decline, state }`.
- Settings: `calls: { incomingMessenger: boolean; incomingInstagram: boolean; ring: boolean }` (mặc định true/true/true), main-owned? Không — renderer ghi được.

### 1.5 Renderer
- Header chat: nút thoại + video (lucide `Phone`, `Video`) trước nút Info khi `features.call` ∈ {audio|both} / {video|both}; disabled + tooltip khi đang có cuộc gọi khác hoặc tài khoản `needs_auth`.
- `IncomingCallBanner.tsx` (Presence in/out, không hover transform), store slot `calls: CallState`, actions `answerCall/declineCall/endCall`.
- Settings → "Calls" section + i18n en/vi. Chuông: file nhỏ trong `resources/sounds`, bật/tắt.

### 1.6 Mức 2 (sau khi mức 1 được chủ sở hữu xác nhận chạy thật)
- CSS inject ẩn chrome của trang gọi, chỉ giữ video; khung Moshi vẽ mute/cam/end/screen-share và điều khiển qua `executeJavaScript` bấm nút tương ứng (selector theo nền tảng, có fallback hiện lại chrome gốc khi không tìm thấy).

## 2. Zalo relay — kiến trúc
Mục tiêu: một máy luôn bật ("relay") giữ session Zalo; các máy khác ("reader") xem và gửi Zalo qua thư mục đám mây, không cần session.

### 2.1 Thư mục & bảo mật
- Dùng thư mục sync hiện có (`sync.folderPath()`) + passphrase/key của zalo-share (`zalo-share.key`). Cấu trúc:
  - `zalo-relay/<ownerId>/state.zrs` — toàn bộ trạng thái reader cần: `{version:1, relayDeviceId, writtenAt, me:{id,name,avatar}, threads:[{id,type,name,avatar,members?,unread,lastAt}], messages:{[threadId]: TMessage[]} (N ngày, mặc định 60), stickers: cache id→url}`; mã hoá như `.zmsg`; ghi atomic; ≤ 50 MB (cắt bớt ngày khi vượt).
  - `zalo-relay/<ownerId>/media/<msgId>.<ext>` — ảnh/sticker/voice ≤ 5 MB do relay tải về (Zalo CDN cần session); reader đọc file.
  - `zalo-relay/<ownerId>/outbox/<readerDeviceId>.json` — hàng đợi gửi của từng reader: `[{uuid, threadId, type, text?, attachments?:[{name,mime,path relative to outbox/files/}], replyTo?, at}]`; reader chỉ ghi file của mình (append, tối đa 200 mục, bỏ mục đã ack).
  - `zalo-relay/<ownerId>/acks/<relayDeviceId>.json` — `{[uuid]: {msgId?, error?, at}}` + `seen` (reader đánh dấu đã đọc: `outbox` có mục `{uuid, type:'seen', threadId}`).
- Chỉ một relay cho một owner: `state.zrs.relayDeviceId`; relay thứ hai thấy relayDeviceId khác và writtenAt < 10 phút → không ghi, báo lỗi "máy X đang là relay".

### 2.2 Relay (máy giữ session) — `src/main/zalo-relay.ts` + `ZaloAdapter`
- Settings → Zalo → "Máy này là relay Zalo cho máy khác" (cần sync + passphrase zalo-share). Khi bật: viết `state.zrs` ngay, rồi mỗi 2 phút hoặc 15 s sau tin mới (debounce), đọc `outbox/*.json` mỗi 20 s: với mỗi mục chưa ack → `adapter.sendMessage`/`markRead` → ghi ack (thành công có `msgId`; lỗi có `error`). Tải media mới ≤ 5 MB vào `media/`.
- Dữ liệu hội thoại lấy từ `friends/groups/raw/archive` sẵn có của adapter (`buildConversations`, `cachedMessages`).

### 2.3 Reader — `src/main/adapters/zalo-relay-adapter.ts`
- Account `id = zalo:relay-<ownerId>`, `platform:'zalo'`, `displayName` = tên owner + " · qua relay", `features` như Zalo nhưng `react:false, unsend:false, call:'none'`. `defaultFactory` nhận nhánh mới **trước** nhánh `platform==='zalo'` dựa trên prefix id. Không chạy khi máy này cũng có tài khoản Zalo sống cùng owner (ẩn, log).
- `connect()`: đọc `state.zrs` (lỗi → `needs_auth` "Không thấy relay"), trạng thái `connected`; poll 20 s: state mới → `conversations:reset` + `message:new` cho tin mới (dedupe msgId); acks → cập nhật tin đang gửi (`status`), lỗi → toast.
- `sendMessage`: ghi mục outbox, trả `Message` tạm `status:'sending'` (id `relay:<uuid>`); khi ack có `msgId` → `message:updated` đổi id. Quá 10 phút không ack → `failed` (Gửi lại dùng được). `markRead` → mục `seen`.
- `fetchMessages` từ state; `downloadAttachment` từ `media/`; sticker Zalo render như adapter thật (có url trong state).
- Onboarding trên reader: Settings → Zalo → "Kết nối Zalo qua máy relay": cần sync + passphrase; liệt kê owner có `state.zrs`; bấm thêm → tạo account.

### 2.4 Giới hạn (ghi trong UI)
- Độ trễ gửi/nhận ≈ 20–60 s (đám mây). Relay tắt → reader hiện "Relay ngoại tuyến từ <giờ>" (writtenAt > 5 phút).
- Gửi file > 5 MB, reaction, thu hồi, gọi: không qua relay (v1).

## 3. Spike "cách 2" — giao thức đồng bộ của Zalo PC
- Đọc **read-only** `C:\Users\thejo\AppData\Local\Programs\Zalo\Zalo-26.10.10\resources\app.asar` (extract vào scratchpad), tìm luồng "đồng bộ tin nhắn từ điện thoại": endpoint, tham số, có cần xác nhận trên điện thoại, có dùng được với session web (zca-js) hay chỉ session PC (imei/device type khác). Kết quả: ghi chú khả thi + ước lượng; **không** triển khai nếu cần session PC riêng (sẽ đá session web).

## 4. Thứ tự thực hiện
1. T10 Calls main (1.1, 1.2, 1.4 phía main) — song song với T11 Calls renderer (1.4 phía bridge/preload/types, 1.5) và T13 Relay writer (2.1, 2.2).
2. T12 Incoming (1.3) sau T10. T14 Relay reader (2.3) + onboarding sau T13.
3. T16 Spike Zalo PC (3) bất kỳ lúc nào (read-only).
4. Mức 2 gọi: sau khi chủ sở hữu xác nhận mức 1 chạy thật.
Kiểm thử: unit cho phần thuần (parser dialog chuông, outbox/ack merge, state trim, cookie→partition); e2e cô lập với demo (nút gọi ẩn vì demo `call:'none'`); gọi thật do chủ sở hữu thử.
