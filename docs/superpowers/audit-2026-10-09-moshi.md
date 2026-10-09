# Moshi v0.7.7 — Audit toàn diện (2026-10-09)

Nhánh `beta` @ ddefdc0, sạch, đồng bộ origin. Baseline: typecheck OK, lint 1 warning, vitest 425/429 pass (4 skipped).
Audit read-only bởi 4 agent song song + xác minh tay các điểm P0/P1. Mọi dòng tham chiếu `file:line` là theo HEAD hiện tại.

---

## A. Đồng bộ tài khoản — trọng tâm Zalo (tin nhắn khi app tắt)

### Cơ chế hiện tại
- zca-js **2.2.0 = bản mới nhất trên npm** (09/2026). Không có REST API nào kéo tin nhắn đã bỏ lỡ; `getGroupChatHistory` (GET group/history) trả 404 cho web session.
- Nguồn lịch sử duy nhất là **socket backfill của chính Zalo Web**: mỗi lần socket (re)connect bắn `cipher_key` → `startSync()` (`zalo.ts:945-959`) gửi `requestOldMessages` (cmd 510/511) cho 1:1 và nhóm, nhận `old_messages`, đi từng trang 600 ms/trang, tối đa **60 trang/lần khởi động** (`zalo-sync.ts:38`), con trỏ `{oldestId, oldestTs, done}` lưu trong cache.
- Cache `zalo-cache-<uid>.json` (1000 tin mới nhất/chat, dedupe `msgId`), tràn ra `zalo-archive-<uid>/<thread>.json` (ghi atomic). Cache chính ghi debounce 15 s, **không atomic**.
- Tin nhắn bỏ lỡ (ts mới hơn cache) → `message:updated` (`zalo.ts:634-663`), hiện trong chat nhưng **không đếm unread**.

### Lỗi cấu trúc (ưu tiên)
| # | Mức | Vị trí | Vấn đề | Kịch bản hỏng | Sửa |
|---|---|---|---|---|---|
| Z1 | **P1** | `zalo-sync.ts:47-50`, `zalo.ts:1020` | Con trỏ chỉ dịch khi trang *sâu hơn* con trỏ cũ. Sau khi tắt lâu, 60 trang đầu đều mới hơn con trỏ → dừng `limit` mà không dịch; lần sau lặp lại y hệt 60 trang | Tắt app 1 tuần, nhóm bận (>~3000 tin) → tin giữa trang 60 và con trỏ cũ **không bao giờ** được kéo | Lưu thêm `resumeBelow` = oldestId trang cuối khi dừng `limit`; lần sau đi tiếp từ đó; tăng limit khi `fresh` vẫn cao |
| Z2 | **P1** | `zalo.ts:699-707` | `closed` với code ≠ 3000/3003 (vd 1006 sau khi zca-js hết retry, retryCount không reset — `listen.js:73-83`) → status vẫn `connected`, không reconnect | Sau vài giờ mạng chập chờn, Zalo im lặng tới khi restart | Với code khác: set `connecting`, gọi lại `api.listener.start({retryOnClose:true})` có backoff, hoặc `manager.reconnect()` |
| Z3 | **P1** | `zalo.ts:111-135`, `manager.ts:578-586` | Login lỗi lúc khởi động (chưa có Wi-Fi) → status `error`, **không có timer retry nào** (chỉ WhatsApp/Gmail tự retry) | Mở máy → Moshi chạy trước Wi-Fi → mọi account treo "error" vĩnh viễn | Backoff reconnect trong `manager.connect()` (30 s→10 phút + jitter), hủy khi remove; trigger thêm trên `powerMonitor 'resume'` |
| Z4 | **P0** | `zalo.ts:1099`, `:203` | Cache ghi `writeFile` trực tiếp, `disconnect()` bắn `void` | Quit/crash giữa lúc ghi → JSON cụt → `loadCache` coi là lần đầu → **mất toàn bộ lịch sử 1:1 + con trỏ** (1:1 không kéo lại được) | tmp+rename như archive, `await` trong disconnect, giữ `.bak` |
| Z5 | P1 | `zalo.ts:1123` | `isRejectedSession` coi *mọi* `ZcaApiError` là cookie chết → xoá credential, đòi QR | Server Zalo hiccup lúc login → bị bắt quét QR lại | Chỉ match mã/thông điệp login thực sự |
| Z6 | P2 | `zalo.ts:162-164` | `archive.ids()` không `await` trước khi walk | Trang đầu đếm nhầm `fresh` → không jump, ghi archive thừa | `await` |
| Z7 | P2 | `zalo.ts:1043-1050` | Timer walk cũ còn sống sau `cipher_key` reconnect → 2 walk xen kẽ | `askedBelow` lệch → dừng `stuck`/`limit` giả | Bộ đếm generation của walk, timer kiểm tra trước khi gọi |
| Z8 | P2 | `zalo.ts:634-663` | Tin bỏ lỡ không tăng unread | Về sau 1 ngày, list không highlight gì → tưởng sync hỏng | Đếm unread cho tin mới hơn `seen` cuối của thread |
| Z9 | P3 | `zalo.ts:613-629` | Echo tin mình gửi emit `message:new` lần 2 (renderer dedupe) | Chỉ tốn CPU | `remember()` trong sendMessage |
| Z10 | P3 | `zalo.ts:1167-1200` | location / contact card / poll / todo hiện bubble rỗng; `group_event` không hiện | — | Map thêm kiểu |

**Kết luận Zalo:** cơ chế đã đúng (dùng chính backfill của Zalo Web) nhưng **hỏng cấu trúc với vắng mặt dài (Z1), socket chết (Z2), khởi động offline (Z3), và mất trắng khi ghi cache đứt (Z4)**. Việc server Zalo có trả đủ khoảng trống cho web session hay không **không xác minh được từ code** — cần log `zalo: direct page N:` sau một lần tắt nhiều giờ thật.

### Adapter khác (bỏ lỡ tin khi reconnect)
- Telegram: lịch sử server-side (gramjs `getHistory`) ✔; không retry nếu `client.start` lỗi offline (chung Z3).
- WhatsApp: Baileys tự reconnect 3 s; lịch sử **chỉ trong RAM** (`syncFullHistory:false`, `whatsapp.ts:84`) → restart là trống tới khi offline queue tới (~vài ngày).
- Messenger cá nhân: `getThreadHistory` server ✔; lỗi MQTT chỉ log, không đổi status.
- Instagram cá nhân: poll + `catchUp(since)` ✔. Meta Page: poll ✔. Slack: history + poll 15 s ✔ (Socket Mode lỗi không retry). Gmail: IMAP IDLE + backoff ✔.

---

## B. Gửi/nhận sticker, GIF, emoji, ảnh, voice, file

### Ma trận gửi (rút gọn)
| Nền tảng | Sticker app/custom | GIPHY sticker | GIF | Voice | File | React |
|---|---|---|---|---|---|---|
| Telegram | ⚠ gửi như **ảnh trắng tĩnh** (`telegram.ts:170`) dù TG có sticker WebP/animated gốc | ⚠ còn frame 0 | ✔ mp4+Animated; mp4 fail → `.gif` document không animated | ✔ (⚠ nếu remux ogg fail vẫn gắn `voiceNote`) | ✔ | ✔ |
| WhatsApp | ⚠ PNG alpha gửi `{image}` → Baileys gắn `image/jpeg` → mất trong suốt (`whatsapp.ts:206`); WA có `{sticker: webp}` + app đã có `photoStickerFiles()` tạo WebP 512 trong suốt (kể cả animated) | ⚠ still trên nền trắng | ✔ mp4 gifPlayback; không mp4 → ảnh tĩnh | ✔ ptt | ✔ | ✔ |
| Zalo | ✔ photo-sticker WebP động | ✔ | ⚠ `.gif` → zca-js fileType "others" → **bubble file**, không inline | ❌ `.ogg` thành file; zca-js có `api.sendVoice` chưa dùng | ✔ | ✔ |
| Messenger | ✔ GIF động | ✔ | ✔ | ✔ m4a | ✔ | ✔ |
| Instagram | ⚠ ảnh trắng; custom animated **throw** | ✔ qua tray (⚠ `TRAY_OPEN` báo thành công dù chưa gửi) | ✔ mp4 | ✔ | ❌ | ❌ |
| Meta Page / Slack / Gmail | ảnh / text-only / attachment | — | — | — | — | Slack chỉ emoji có tên |

### Lỗi (ưu tiên)
| # | Mức | Vị trí | Vấn đề | Sửa |
|---|---|---|---|---|
| M1 | **P1** | `App.tsx:473`, `ChatView.tsx:539`, `Composer.tsx:347-366` | Composer không `key` theo chat → đang ghi âm ở A, chuyển sang B rồi dừng → **voice gửi vào B**; popover sticker/GIF cũng giữ qua chat | `<Composer key={conversation.id}>` hoặc hủy recording trong effect `[selectedId]` |
| M2 | **P1** | `store.ts:803-808`, `ChatView.tsx:769-783` | Gửi lỗi → bubble `failed`, text + `pendingFiles` đã bị xoá, **không có Gửi lại/Xoá** | Giữ `OutgoingAttachment[]` trên tin lỗi, thêm `retry()` + nút Resend/Delete |
| M3 | **P1** | `whatsapp.ts:206` | Sticker WA = JPEG | `if (file.sticker) sendMessage(jid, { sticker: { url: (await photoStickerFiles(file)).webp } })` |
| M4 | **P1** | `telegram.ts:170` | Sticker TG = ảnh trắng | gửi WebP làm document `image/webp` + `DocumentAttributeSticker` (animated: `video/webm`) |
| M5 | **P1** | `GifPicker.tsx:65,120-124` | Chỉ đọc `settings.gif.key`, bỏ qua `BUILT_IN_GIF` của main → hiện "set up a key" dù build có key (GiphyStickers đã làm đúng) | dùng `gifDefault()` như GiphyStickers |
| M6 | **P1** | `zalo.ts:332-409` | Voice Zalo thành file; GIF thành file | `uploadAttachment` → `api.sendVoice({voiceUrl})`; GIF gửi mp4 alternate (fileType video) |
| M7 | P2 | `gifs.ts:248` | mp4 tải lỗi bị nuốt `.catch(()=>undefined)` → WA/TG gửi ảnh tĩnh im lặng | toast "sent as still" hoặc tạo mp4 local |
| M8 | P2 | `gifs.ts:179-180` | `sharp(gif.path)` không `{animated:true}` → frame 0 | theo M3/M4 |
| M9 | P2 | `stickers.ts:220` | Custom animated không có alternate opaque → IG throw, WA frame 0 | tạo PNG opaque trang 0 |
| M10 | P2 | `index.ts:1175-1181` | webm→ogg fail vẫn `voice:true` → WA/TG claim opus → không decode | fallback AAC alternate hoặc bỏ `voice` |
| M11 | P2 | `direct-composer.ts` sendStickerNow | `TRAY_OPEN` trả thành công | throw để fallback chạy |
| M12 | P2 | `EmojiPicker.tsx:109-111` | Search `e.includes(q)` trên ký tự emoji → gõ chữ luôn "No results"; không skin tone | thêm keyword list (emojibase compact) |
| M13 | P3 | `utils.ts:202-215` | `©®™` lẻ bị coi jumbo | loại trừ trừ khi có FE0F |
| M14 | P2 | `ChatView.tsx:974,1136,1153`, `whatsapp.ts:620`, `telegram.ts:545` | Sticker WA nhận / TG animated (tgs/webm) không `loadAttachment` → hiện chữ "Sticker"; sticker `<img>` không `onError`/lightbox | gọi `loadAttachment` on mount như AudioPlayer |
| M15 | P2 | `telegram.ts:546` | GIF TG nhận chỉ thumbnail tĩnh | lazy `loadAttachment` khi vào viewport |
| M16 | P2 | `MessageParts.tsx:179-185` | GIF `<video autoPlay loop>` không IntersectionObserver → 50 GIF trong chat = CPU liên tục | observe play/pause + pause khi `window-idle` |
| M17 | P3 | `Composer.tsx:313` | `insertEmoji` dùng state `text`, có thể đè từ đang IME compose | đọc từ textarea, chờ compositionend |

Tests: **không có test nào** cho đường gửi attachment của bất kỳ adapter, `stickerFile()/customStickerFile()/giphyStickerFile()`, store `send()` optimistic→failed, GifPicker key state (M5 lẽ ra bị bắt).

---

## C. Main process / IPC / storage

| # | Mức | Vị trí | Vấn đề | Sửa |
|---|---|---|---|---|
| C1 | **P0** | `storage.ts:71-80` | `persist()` chain `this.writing.then(...)` **không catch** → 1 lần EPERM (AV giữ file khi rename, phổ biến trên Windows) → **mọi lần ghi sau đều reject**: không lưu settings/account/secret tới khi restart; `scheduler.start()` không bao giờ cài interval | `this.writing = this.writing.catch(()=>{}).then(... retry rename 3× ...)` + log |
| C2 | **P0** | `storage.ts:49-69` | `load()` lỗi parse → `EMPTY` im lặng → lần `setSettings` đầu (appLock.load `lock.ts:69`) **ghi đè unison.json trống** → mất session mọi account | đổi tên file hỏng `unison.json.corrupt-<ts>`, giữ `.bak` trước rename, emit notice |
| C3 | **P1** | `manager.ts:578-586` | connect không retry/backoff (= Z3) | như Z3 |
| C4 | **P1** | `manager.ts:282-302`, `web-partitions.ts:51-54` | Xoá FB/IG cá nhân ở legacy partition **không xoá cookie**, không logout → "Add account" tự re-add account cũ | `clearStorageData({storages:['cookies']})` khi không còn ai dùng partition |
| C5 | **P1** | `storage.ts:174-180`, `manager.ts:794-829` | DPAPI decrypt fail → account **biến mất im lặng** | tạo adapter `needs_auth` + lý do |
| C6 | **P1** | `lock.ts:60-71,131-134` | Lỗi đọc lock.json ≠ ENOENT → xoá luôn `settings.appLock`; ghi không atomic | chỉ ENOENT = không khoá; tmp+rename |
| C7 | **P1** | `index.ts:733-736` | `will-navigate` guard vô hiệu với `file://` (origin = 'null') → thả file ngoài drop zone thay thế cả app | so `url.startsWith(appPage)` |
| C8 | P2 | `store.ts:468-488`, `index.ts:1814-1815`, `manager.ts:739-747` | Không replay event khi renderer load muộn → `auth:prompt` kẹt, account treo "connecting" | IPC `auth:pending` + register onEvent trước list |
| C9 | P2 | `scheduler.ts:85-93` | tick() không LATE_GRACE sau sleep → tin hẹn 9h gửi lúc 17h | `missed` nếu quá grace |
| C10 | P2 | `scheduler.ts:104`, `rate-limit.ts:19-24`, `manager.ts:325` | RATE_LIMIT làm tin hẹn `failed` vĩnh viễn; slot limiter bị lấy trước khi gửi thành công | retry như `connecting`; lấy slot sau khi gửi |
| C11 | P2 | `manager.ts:282-302`, `index.ts:468-510` | remove() không gọi `insightStore.forget()` (0 caller), không prune `scheduled/snoozed/followUps/todos` | gọi forget + prune 4 key |
| C12 | P2 | `index.ts:1203-1221` | `openPath` file `.exe/.bat/.lnk/.hta/.js/.vbs/.scr/.msi` từ chat → **chạy luôn** | `showItemInFolder` hoặc confirm |
| C13 | P2 | `index.ts:1481-1492` | settingsSet nhận cả key main-owned (`appLock`, `scheduled`...) | strip trước khi merge |
| C14 | P2 | `index.ts:1828-1845` | before-quit không await `manager.shutdown()` + flush storage; `reminders.stop()` không gọi | preventDefault, `Promise.race([all, 4s])`, rồi quit |
| C15 | P2 | `manager.ts:588-595` | loadConversations chỉ add, không xoá chat cũ của account khi reconnect | xoá entry account trước set |
| C16 | P2 | `manager.ts:304-310` | reconnect() không guard → 2 click = 2 listener/MQTT | Map<accountId, Promise> |
| C17 | P2 | `ai/service.ts:149-162,185-188` | exit handler worker cũ null `this.worker` vô điều kiện → worker mới mồ côi, giữ model | `if (this.worker === worker)` |
| C18 | P2 | `index.ts:1431-1439` | reconnect web account khi `connecting`/`error` mở cửa sổ login thay vì reconnect | chỉ khi `needs_auth` |
| C19–27 | P3 | — | IPC base64 80 MB, LRU attachment, sort O(n log n)/insert, ai-cache không atomic, tray label không đổi ngôn ngữ, openExternal about:blank, hidden window không setWindowOpenHandler, updater `allowPrerelease`, focusChat không check isDestroyed | — |

Bảo mật nền tảng ổn: sandbox+contextIsolation mọi window, setWindowOpenHandler deny, IPC sender-frame check, CSP packaged, proxy host allowlist, không TODO/FIXME trong src.

---

## D. Renderer — UI/UX, hiệu năng, animation

Đã xác minh **tốt**: mesh tĩnh, `transition: all` = 0, reduced-motion toàn cục, Zustand selector ổn định, Bubble `memo`, IME guard Composer đúng, token 140/220/380 ms + spring, keyframes chỉ transform/opacity, will-change chỉ trên graphic.

### P1 — lỗi UI rõ
| # | Vị trí | Vấn đề | Sửa |
|---|---|---|---|
| U1 | (= M2) | Gửi lỗi không Retry/Delete | — |
| U2 | `TodoSheet.tsx:226,435`, `TagEditor.tsx:48`, `NewChatSheet.tsx:71`, `CommandPalette.tsx:109` | Enter không guard `isComposing` → gõ Telex "việc"+Enter lưu "vie" | helper `isComposingEnter(e)` dùng chung |
| U3 | `CommandPalette.tsx:69`, `ForwardSheet.tsx:18`, `SettingsSheet.tsx:84` | Sheet không focus trap/không trả focus; Tab đi xuyên backdrop | `inert` pattern như lock screen (`App.tsx:433-437`), lưu opener |
| U4 | `ConversationList.tsx:141,335,386` | Menu ngữ cảnh đóng khi bấm *bất kỳ* phím; `<span role=button>` lồng trong `<button>` | role menu + arrow/Enter/Esc; tách nút "…" |
| U5 | `Sidebar.tsx:117-125,367`, `app.css:5854,11094` | `.tag-popover` fixed trong sidebar có backdrop-filter → lệch vị trí ở Liquid | `createPortal(document.body)` |
| U6 | `app.css:4575` vs `:4532`, `store.ts:1548` | Toast z 60 < lightbox z 80 → lỗi ẩn; 1 slot toast → Undo bị đè | z 90 + stack 2 |

### P2 — hiệu năng
| # | Vị trí | Vấn đề | Sửa |
|---|---|---|---|
| U7 | `App.tsx:361` | `wheel` listener **non-passive trên window** cho Ctrl-zoom → mọi tick cuộn phải đợi main thread | chỉ gắn khi Ctrl đang giữ |
| U8 | `store.ts:1681-1682,1719`, `ChatView.tsx:479,698` | `useThread`/`useSendVia` subscribe cả `settings` + `conversations` → tin đến ở chat *khác* re-render thread đang mở + virtualizer + mọi `Group` (không memo) | `useShallow` chỉ member chats; `memo(Group)`; hoist `platformOf` |
| U9 | `ConversationList.tsx:318-437` | Mọi row inline, ~40 selector → typing ở chat nào cũng render lại toàn list (`Date.now()`, `formatListTime`, birthday, 6 icon/row) | `memo(ConversationRow)` props primitive, `now` tính 1 lần |
| U10 | `ChatView.tsx:928-960` | ~24 selector/Bubble × 60 bubble ≈ 1.4k selector/`set()` | gom `useShallow` |
| U11 | `Composer.tsx:171-181` | autosize `height=auto` → đọc scrollHeight = 2 reflow/phím | `field-sizing: content` (đã dùng chỗ khác) |
| U12 | `app.css:1944,2434` | `bubble-in` chạy lại mỗi lần row virtualized remount → lịch sử "pop" khi cuộn lên | chỉ `.bubble-row.fresh` (sentAt < 3 s) |
| U13 | (= M16) | GIF video không pause | — |
| U14 | `store.ts:2118` | `useUnreadCounts` tính 3× (Sidebar/TitleBar/BadgeSync) | derive 1 lần trong subscribe |
| U15 | `app.css:11447-12807` + others | ~500 dòng CSS chết (`.todo-*` cũ, `stat-card`, `details-kv`, `profile-facts`, `welcome-logos`, `sticker-cutout*`, 72 class không dùng); `.msg-group-body` định nghĩa 8×, `.chat-scroll` 6×; `.conv-item` transition transform không có transform | xoá + gộp |
| U16 | `store.ts:488` | `bridge.onEvent` trong `init()` không unsubscribe → StrictMode dev xử lý event 2 lần | giữ unsubscribe module-level |
| U17 | `app.css:11018,15818-15834` | blur 44 px × 4 pane; animation trong pane re-blur vùng damaged | cap ~24 px; `window-idle` → opaque |

### P3 — polish
U18 không có pill "tin mới ↓" khi không stick bottom (`ChatView.tsx:381-386`); U19 Esc đóng mọi lớp cùng lúc (`App.tsx:412`); U20 **7 chỗ hover scale/translate trên control chữ/icon** trái motion rule (`app.css:2088,2201,3297,14563,15282,3991,1705`); U21 popover composer clip dọc (`app.css:3222`, `popover.ts:24-46` chỉ clamp X); U22 scroll position không giữ theo chat; U23 narrow list↔chat `display:none` giật; U24 `.conv-more` tabIndex -1 không tới được bằng phím.

### Animation
- **Không có exit animation ở đâu cả** (sheet/backdrop/menu/toast/lightbox/emoji sheet unmount tức thì sau spring-in 220–380 ms) → dấu hiệu "chưa mượt" lớn nhất. Fix chung: hook `usePresence(open, 180)` + keyframes `*-out` (opacity + translateY 8px scale .98, 160–180 ms).
- **View Transitions API** sẵn trong Electron 44: dùng cho narrow list↔chat, inbox↔archive, sidebar collapse, details open/close.
- Row list nhảy lên đầu khi có tin mới = teleport (`ConversationList.tsx:333`) → FLIP bằng `el.animate()` transform 220 ms.
- Height-auto thrash: `.composer-box.tall`, `.reply-banner` → `interpolate-size`/`grid-template-rows 0fr→1fr`.

---

## E. Kế hoạch đề xuất (theo đợt, mỗi đợt test + commit riêng)

**Đợt 1 — Không mất dữ liệu & sync bền (P0/P1 backend):** C1, C2, Z4, Z1, Z2, Z3/C3 (+ powerMonitor resume), Z5, Z6, Z7, C5, C6, C14, C16. Thêm test: storage chain poison/corrupt, Zalo limit-resume, closed→reconnect.

**Đợt 2 — Gửi media đúng nền tảng:** M1, M2/U1, M3, M4, M5, M6, M7, M9, M10, M11, M14, M15, M16/U13. Thêm test cho hàm chọn format/alternate từng adapter.

**Đợt 3 — Hiệu năng renderer:** U7, U8, U9, U10, U11, U12, U14, U16, U15 (dọn CSS), U17.

**Đợt 4 — UI/UX + animation:** U2, U3, U4, U5, U6, U18, U19, U20, U21, U24, `usePresence` exit animations, View Transitions cho narrow/sidebar/details, FLIP list rows, M12 emoji search.

**Đợt 5 — Dọn dẹp main:** C4, C7, C8, C9, C10, C11, C12, C13, C15, C17, C18, Z8, Z10.

Xác minh: vitest + typecheck + lint sau mỗi đợt; chạy app **cô lập** (`electron-vite dev -- --user-data-dir=<temp>` + demo adapter, không bao giờ đụng profile thật) để đo re-render/scroll/animation bằng CDP; các điểm "UNCONFIRMED live" (sticker WA/TG/Zalo thật, Zalo backfill sau khi tắt nhiều giờ) cần bạn test trên app cài đặt với tài khoản thật rồi gửi log.
