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
