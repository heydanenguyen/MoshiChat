## Moshi 0.4.0

Bản tập trung vào **nhẹ, mượt và an toàn**. Không tính năng nào bị bỏ; từ 0.3.x, Moshi tự tải bản này ở nền và chỉ hỏi bạn khởi động lại.

### Mượt hơn với chat dài và nhiều hội thoại
- **Khung chat chỉ vẽ những tin đang thấy:** với cuộc trò chuyện 2.000 tin, mở chat từ khoảng 5 giây xuống dưới 0,1 giây, tin mới đến không còn làm khựng. Mở chat luôn ở tin mới nhất, cuộn lên đọc thì tin mới không kéo bạn xuống.
- **Ít tốn bộ nhớ khi để Moshi chạy cả ngày:** các cuộc trò chuyện lâu không mở được giải phóng (mở lại thì tải lại ngay), sticker của bạn không còn nằm trong bộ nhớ dưới dạng chuỗi lớn.
- **Khởi động nhẹ hơn:** Cài đặt, thêm tài khoản, sao lưu, chỉnh ảnh… chỉ tải khi bạn mở lần đầu.
- **Ít ghi đĩa hơn:** dữ liệu Thân thiết và bộ nhớ đệm Zalo được lưu thưa hơn thay vì sau mỗi tin nhắn; tệp tạm cũ hơn một tuần được tự dọn.

### Kết nối nền nhẹ hơn
- **Instagram:** cửa sổ ẩn dùng để nhận tin theo thời gian thực không tải ảnh, video, phông chữ nữa; hộp thư không còn bị tải lại liên tục sau mỗi lượt "đã xem" hay cảm xúc (tối đa mỗi 4 giây), và tạm dừng khi mất mạng.
- **Telegram:** ngắt kết nối giờ ngắt hẳn, không còn vòng lặp chạy ngầm.
- **WhatsApp:** mỗi tin mới chỉ cập nhật đúng cuộc trò chuyện đó thay vì gửi lại cả danh sách.

### An toàn hơn
- Chỉ những tệp **bạn tự chọn hoặc kéo vào** mới gửi được; nội dung hiển thị trong app không thể tự gửi tệp khác trên máy.
- Mọi lệnh nội bộ chỉ được nhận từ chính giao diện Moshi.
- Ảnh từ Facebook/Instagram chỉ được tải từ máy chủ ảnh của họ, không thể dùng phiên đăng nhập của bạn để mở trang khác.
- Trên Linux không có kho khoá (keyring), Moshi báo cho bạn biết phiên đăng nhập chưa được mã hoá thật sự.

### Ổn định hơn
- Một phần giao diện gặp lỗi chỉ hiện thông báo nhỏ và nút thử lại, không làm trắng cả cửa sổ; lỗi trước đây bị bỏ qua im lặng giờ được ghi lại và báo nhẹ.

### Lưu ý
- Đã chạy trên Windows với dữ liệu mẫu, cả bản build thật. Các thay đổi cho Instagram, Telegram và WhatsApp được kiểm tra bằng bài kiểm tra tự động, chưa thử lại với tài khoản thật.
- Khi tải thêm tin cũ ở đầu cuộc trò chuyện, khung nhìn có thể lệch khoảng một bong bóng.

---

### English
A release about being **lighter, smoother and safer**. Nothing was removed; from 0.3.x, Moshi downloads it in the background and only asks you to restart.

- **Long chats:** the thread draws only the messages on screen. With 2,000 messages, opening a chat went from about 5 s to under 0.1 s, and new messages no longer stall it. Chats open on the newest message; reading further up, new messages do not pull you down.
- **Memory over a long day:** chats not opened for a while are let go (they load again when opened); your own stickers no longer sit in memory as large strings.
- **Startup:** Settings, adding accounts, backup, the photo editor and others load the first time you open them.
- **Disk:** Close friends data and the Zalo cache are saved less often instead of after every message; temporary files older than a week are cleaned up.
- **Connections:** Instagram's hidden realtime window no longer loads images, video or fonts, its inbox refreshes at most every 4 s and pauses offline; Telegram disconnects for real; WhatsApp updates only the chat a message is in.
- **Safety:** only files you picked or dropped can be sent; internal commands answer only Moshi's own interface; Facebook/Instagram images load only from their image servers, never a page through your session; Linux without a keyring is told its sessions are not really encrypted.
- **Stability:** a part of the window that fails shows a small note and a retry instead of a blank window; errors that used to vanish are logged and shown gently.
- Notes: ran on Windows with sample data, including the real build. The Instagram, Telegram and WhatsApp changes are covered by automated tests, not yet re-tried with real accounts. Loading older messages at the top of a chat can leave the view about one bubble off.
