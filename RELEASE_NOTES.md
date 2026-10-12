## Moshi 0.9.0

**Gói chuyển động đợt 1 "Calm": app có khối lượng và nhịp, nhưng không ồn.** Mọi chuyển động chạy bằng lò xo thật (đường cong giảm chấn tính ra `linear()`), chỉ dùng transform và opacity, và đều có bản rút gọn khi hệ điều hành bật "giảm chuyển động". Áp dụng cho cả bốn giao diện; Mono không nảy.

### Trong cuộc chat
- **Gửi tin:** bubble bật lên từ ô soạn, vượt nhẹ rồi lắng; sticker xoay vào, ảnh hiện nét dần; ô soạn "thở ra" một nhịp. Gửi liên tiếp không bị nhảy lại.
- **Tin đến:** bubble trượt lên có khối lượng, nhiều tin đến cùng lúc thì nối nhau 40 ms; avatar gật đầu đúng một lần.
- **Đã xem:** dấu tích thứ hai tự vẽ ra và chuyển màu nhấn, ở cả bubble và hàng danh sách.
- **Đang gõ:** ba chấm nhấc lên theo sóng, cả bubble thở nhẹ; dừng gõ thì chạy nốt nhịp rồi nghỉ; tạm dừng khi cửa sổ ẩn.

### Bố cục
- **Ô soạn tin (giao diện Moshi):** nút gửi xoay vào khi có chữ, mic xoay ra; "Gửi sau" mở từ biểu tượng ra đủ chữ.
- **Details:** panel trượt vào bằng lò xo, cột chat lùi 24 px rồi nét dần, có chiều sâu.
- **Skeleton:** lần mở chat đầu, ảnh và video đang tải, hàng danh sách khi tài khoản đang kết nối dùng khối vệt sáng chéo thay cho vòng xoay, chỉ hiện nếu tải lâu hơn 300 ms.
- **Khởi động:** sidebar, danh sách rồi khung chat lần lượt hiện trong chưa đến 600 ms sau màn hình chào.

### Lưu ý
- Đợt 2 (reaction tung hạt, avatar bay lên header, đổi sáng/tối vòng tròn, tab bar chảy, viên cuộc gọi kiểu Island, cuộn có chiều sâu, nhấn lún) và đợt 3 (mascot Pals, ăn mừng) sẽ ra ở các bản sau.

---

### English
- **Motion pack 1 "Calm":** real spring curves (damped springs rendered into CSS `linear()`), transform and opacity only, with a reduced-motion fallback for each; all four styles, Mono without overshoot.
- Chat: sent bubbles pop from the composer and settle (sticker twist, photo un-blur, composer exhale; rapid sends resume mid-flight), incoming bubbles slide up with a stagger and one avatar nod, read receipts draw their second check, typing dots rise in a wave while the bubble breathes.
- Layout: the send button springs in as the mic turns away and "Send later" unfolds (Moshi look); the Details pane slides in on a spring while the chat column eases back and un-blurs; skeleton shimmer for the thread's first load, media and list rows (only after 300 ms); a launch choreography under 600 ms.
- Waves 2 and 3 of the motion catalogue follow in later releases.

## Moshi 0.8.3

**Cập nhật trong app cài được trở lại.** Từ bản này, bấm "Cập nhật" trong Moshi sẽ cài xong; bản 0.8.2 trở về trước cần cài tay một lần bằng file Moshi-Setup từ trang Releases.

### Cập nhật
- **Sửa lỗi "không cài được" khi cập nhật trong app:** trình cài bản mới gỡ bản cũ bằng bộ gỡ đang đăng ký trong Windows. Bộ gỡ của Moshi (cửa sổ tạm biệt) lại chạy bộ gỡ NSIS ngay trong thư mục cài, nên file của chính nó không dời đi được và cả bước cập nhật bị hủy (mã lỗi 2). Giờ trước khi cài, Moshi trỏ mục gỡ sang bộ gỡ NSIS như bộ cài đầy đủ vẫn làm; bộ gỡ của Moshi cũng chạy bản sao ở thư mục tạm và ghi một dòng vào %TEMP%\moshi-setup.log nếu có gì trục trặc.

### Lưu ý
- Bản 0.8.2 (hoặc cũ hơn) không tự cập nhật lên được vì lỗi nằm ở phía bản đang cài: tải Moshi-Setup-0.8.3.exe từ Releases và chạy một lần. Sau đó các bản sau cập nhật trong app bình thường.

---

### English
- **In-app updates install again:** the installer removes the old version through the registered uninstaller; Moshi's branded uninstaller ran the NSIS one in place, which cannot move its own file, so the update's removal step failed (error code 2). Before installing, Moshi now points the entry at the NSIS uninstaller, as the full setup does; the branded uninstaller also runs a temp copy and notes problems in %TEMP%\moshi-setup.log.
- Note: 0.8.2 and older cannot update themselves to this version (the bug is on the installed side): run Moshi-Setup-0.8.3.exe from Releases once; later versions update in-app.

## Moshi 0.8.2

**Gửi tin Facebook được trở lại, giao diện mặc định mới "Quiet Glass" dễ đọc hơn, Instagram không còn tự dừng nhận tin.** Moshi tự tải bản này ở nền và chỉ hỏi bạn khởi động lại.

### Facebook
- **Sửa lỗi "server error 500" khi gửi tin:** Facebook thôi nhận tin qua đường gửi cũ mà Moshi dùng. Giờ tin chữ và tin trả lời đi qua kết nối thời gian thực, giống bản web Facebook; nếu kết nối đó chưa sẵn sàng thì Moshi tự dùng lại đường cũ. Tin có ảnh, tệp vẫn đi đường cũ.

### Giao diện mặc định "Quiet Glass"
- Một màu nhấn dịu, chữ trên màu nhấn dễ đọc hơn; nhãn mục viết hoa đầu câu; cỡ chữ thống nhất.
- Dòng chat cao 64 px, nhìn là biết trạng thái: chấm chưa đọc ở mép, giờ màu nhấn, ba chấm khi đang gõ, "Nháp" màu đỏ, biểu tượng tắt tiếng, ghim, bạn thân, đã xem và một nhãn ngay trên dòng.
- Đầu khung chat cao 64 px với nút tròn; ô soạn tin dạng viên kính (mic khi trống, nút Gửi và "Gửi sau" khi đang gõ, thanh âm lượng khi ghi âm); banner cuộc gọi đến nằm giữa dưới thanh tiêu đề.
- Các cột là nền phẳng ngăn bằng đường mảnh, chỉ thanh tiêu đề và ô soạn tin có hiệu ứng kính. Cửa sổ hẹp có hàng chọn ứng dụng dưới ô tìm, thanh tab bốn mục và nút Quay lại kèm số tin chưa đọc.
- Sticker và lưới ảnh gửi đi không còn bị viền mảnh màu nhấn.
- Giao diện Liquid, Mono và Pals giữ nguyên.

### Instagram
- **Không còn tự dừng nhận tin:** trang hộp thư ẩn tự tải lại mỗi 30 phút; nếu đúng lúc đó Moshi đang hỏi tin mới, việc hỏi bị treo mãi và tài khoản im lặng tới khi mở lại app. Giờ Moshi bỏ lượt đó rồi thử lại.

### Thử nghiệm
- Cài đặt › Dữ liệu có hai nút thử tính năng "đồng bộ tin nhắn từ điện thoại" của Zalo: gửi yêu cầu một lần và ghi lại Zalo trả lời gì, để biết phiên web có được dùng tính năng này không. Không đổi gì trong cách Moshi xử lý tin.

### Lưu ý
- Gửi tin Facebook qua kết nối thời gian thực chưa được thử với tài khoản thật; nếu tin không đi, log trong app ghi lại để sửa. Bản Windows chưa được thử bằng tay.

---

### English
- **Facebook sends again:** Facebook stopped taking messages on the old endpoint Moshi used ("server error 500"). Text and replies now go over the realtime connection, as Messenger's web app sends them, falling back to the old endpoint when that connection is not up; photos and files still use the old one.
- **"Quiet Glass", the new default style:** one calm accent with more readable text on it, sentence-case labels, a consistent type scale; 64 px rows whose state reads at a glance (unread dot, time in the accent, typing dots, red Draft, mute, pin, close friend, read receipts, one inline tag); a 64 px chat header with round actions; a glass composer pill (mic when empty, Send and Send later while typing, a level meter while recording); flat columns with glass only on the title bar and composer; a chip row, a four-item tab bar and a Back button with the unread count in narrow windows. Sent stickers and photo grids lose the pale-accent hairline. Liquid, Mono and Pals are unchanged.
- **Instagram no longer goes quiet:** a poll caught by the hidden inbox page's half-hourly reload used to hang for good; it now gives up and tries again.
- **Experiment:** two buttons in Settings › Data ask Zalo once for its "sync messages from the phone" and record the answer.
- Notes: sending over Facebook's realtime connection is not yet tried with a real account; the Windows build is not hand-tested.
