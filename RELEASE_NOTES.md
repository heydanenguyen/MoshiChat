## Moshi 0.3.0

Bản chính thức, gom mọi thứ từ các bản beta 0.3.0. Ai đang dùng 0.2.x hoặc bản beta sẽ được mời cập nhật ngay trong app.

### Sticker
- **Sticker GIPHY:** tab ✨ mới trong khung sticker, đúng kho sticker mà Instagram dùng. Gửi sang Instagram, Moshi chọn sticker trong khung sticker của chính instagram.com nên người nhận thấy sticker động, nền trong suốt; Messenger và Zalo cũng nhận sticker động trong suốt. Sticker GIPHY bạn bè gửi được giữ lại để gửi lại một chạm. Cần một key GIPHY miễn phí (loại API).
- **Album "Của tôi":** ô *Thêm* ngay đầu lưới kèm công tắc *Tách nền*; **kéo thả ảnh** vào khung hoặc **dán bằng Ctrl+V** là thành sticker. Sticker dán nghiêng nhẹ như trên trang album, nhấc lên khi rê chuột; cái vừa tạo hoặc vừa gửi lên đầu. Chuột phải để gửi, đổi tên, tách nền hoặc xoá.
- **Tách nền đẹp hơn hẳn:** mô hình mới (BiRefNet) tách gọn thú cưng, đồ vật lẫn người, đến từng sợi ria; sticker được cắt sát và có viền trắng như sticker bế. Lần đầu tải 115 MB, mỗi ảnh vài giây, chạy hoàn toàn trên máy.
- **Hiệu ứng tạo sticker:** ảnh được quét nhẹ trong lúc tách nền, rồi sticker nhấc khỏi ảnh với quầng sáng theo viền và bay vào album.
- **Sticker gửi sang Zalo** trong suốt và chuyển động; **sticker Zalo nhận về** chuyển động đúng nhịp như trên Zalo.
- Bộ **Mito** đã có trên GIPHY; khi GIPHY duyệt kênh, Mito gửi qua Instagram sẽ tự thành sticker động.

### Bạn bè và nhịp trò chuyện
- **Hoãn hội thoại** (⌘⇧H) tới tối nay, sáng mai, cuối tuần… và **nhắc nếu chưa trả lời**, với bảng chọn giờ dễ nhìn.
- **Ghi chú về người**, **nhắc sinh nhật**, thẻ **"Lâu rồi chưa nhắn"** khi một người thân im lặng lâu hơn thường lệ.
- **Thân thiết** thiết kế lại kiểu tổng kết năm: quỹ đạo bạn bè, giờ vàng, chuỗi ngày, bục vinh danh vàng/bạc/đồng, và nút **Chia sẻ** ra ảnh story 1080 × 1920.
- **Cảm xúc trên Zalo** hiện đúng như Zalo: mỗi người một cảm xúc, nhớ qua mỗi lần mở app, viên cảm xúc gọn ở góc bong bóng.
- **Trả lời ngay trên thông báo** (macOS).

### Riêng tư
- **Khoá Moshi bằng mã**, tự khoá khi rời máy; lúc khoá thông báo chỉ ghi "Có tin mới".
- **Ẩn Moshi khi chia sẻ màn hình** (Zoom, Meet, ảnh chụp màn hình).
- Mã xác minh trong bản xem trước được che bằng dấu chấm.

### Giao diện
- **Liquid Glass** làm lại cho giống Apple, nhẹ máy hơn nhiều (CPU lúc rảnh từ hơn một nhân xuống khoảng 1%).
- Danh sách tin nhắn gọn hơn, mép mờ cho khung chat và trang chi tiết, thẻ "Có thể là cùng một người" mới, bảng lệnh (⌘K) tìm cả hội thoại lẫn lệnh.
- Sửa: thanh cuộn ngang khi rê chuột trong khung chat; nút đính kèm bị lệch ở cửa sổ hẹp; sticker nháy khi rê chuột.

### Cập nhật và nền tảng
- **Tự cập nhật:** bản mới tự tải ở nền, chỉ hỏi bạn khởi động lại (hoặc tự cài khi tắt Moshi). Tắt được ở Cài đặt → Chung → Cập nhật. Riêng lần lên bản này, bản cũ vẫn cần bấm *Cập nhật* một lần.
- **Electron 44 (Chromium 152):** nền tảng cũ đã hết được vá bảo mật; bản này đóng các lỗ hổng đó.

### Lưu ý
- Gửi sticker GIPHY qua khung sticker của Instagram và cảm xúc Zalo **chưa được thử với tài khoản thật**; nếu có lỗi, Moshi báo rõ và ghi nhật ký.
- Trên macOS (chưa ký với Apple) Moshi chỉ báo có bản mới và mở trang tải về; trả lời từ thông báo chỉ có trên macOS.
- Thư viện Messenger cá nhân (ws3-fca) vẫn kéo theo vài gói có cảnh báo bảo mật mà chưa có bản vá tương thích; rủi ro thấp vì chúng chỉ xử lý dữ liệu từ máy chủ Facebook.

---

### English
**Moshi 0.3.0**, everything from the 0.3.0 betas. Installed 0.2.x and beta versions are offered the update in the app.

- **Stickers:** a GIPHY tab (the library behind Instagram's sticker tray; on Instagram they arrive as real moving, see-through stickers, picked in instagram.com's own tray; GIPHY stickers friends send are kept to send back). "Mine" is a sticker album: an add tile with a cut-out switch, drop or paste a picture to make one, stickers stuck on slightly askew, a right-click menu. Background removal now uses BiRefNet: pets, objects and people come out clean, trimmed with a white die-cut edge (115 MB once, a few seconds a picture, on this computer), with a scan-and-lift animation while it works. Stickers to Zalo arrive see-through and moving; Zalo stickers play at Zalo's pace. Mito is on GIPHY and becomes a real Instagram sticker once the channel is approved.
- **People:** snooze chats and follow-ups, notes, birthday reminders, a "been a while" card; Close friends redesigned like a year in review with a shareable story picture; Zalo reactions shown as Zalo does; reply from notifications (macOS).
- **Privacy:** passcode lock, hide Moshi from screen sharing, codes masked in previews.
- **Look:** Liquid Glass rebuilt (idle CPU from over a core to about 1%), a tidier list, edge fades, a new "same person" card, a command palette that finds chats and commands; fixes for a sideways scrollbar, the attach button in narrow windows and sticker flicker.
- **Updates:** new versions download in the background and only ask for a restart (or install on quit); can be turned off in Settings → General → Updates. Getting to this version still takes one click from an older one.
- **Electron 44 (Chromium 152)**, closing the advisories against the old one.
- Notes: sending GIPHY stickers through Instagram's tray and Zalo reactions are **not yet tried with real accounts** (failures are reported and logged). Unsigned macOS builds only point to the download page; replying from notifications is macOS only. The personal Messenger library (ws3-fca) still pulls in a few packages with advisories and no compatible fix; exposure is low.
