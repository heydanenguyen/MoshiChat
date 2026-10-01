## Moshi 0.3.1

Bản sửa lỗi quan trọng cho 0.3.0, nên cập nhật ngay. Từ 0.3.0, Moshi tự tải bản này ở nền và chỉ hỏi bạn khởi động lại.

### Messenger
- **Không còn tự đánh dấu "đã xem":** trước đây mỗi lần mở Moshi, mọi cuộc trò chuyện Messenger bị đánh dấu đã đọc, nên bạn bè thấy "đã xem" dù bạn chưa mở. Giờ chỉ khi bạn đọc (và theo công tắc gửi trạng thái đã xem).
- **Không còn tin nhắn và thông báo bị nhân đôi:** ngắt kết nối Messenger giờ ngắt thật; xoá tài khoản hay đăng nhập lại không còn để lại kết nối cũ chạy song song.

### Nhẹ và mượt hơn
- Nền phía sau đứng yên ở mọi kiểu giao diện: lúc đang dùng app, CPU giảm từ khoảng nửa nhân xuống dưới 10%.
- Danh sách hội thoại chỉ vẽ những dòng đang thấy: với hàng nghìn cuộc trò chuyện, mở và cuộn nhanh hơn hàng chục lần, tin mới đến không làm khựng.
- Khung chat không còn vẽ lại khi một cuộc trò chuyện khác có tin; mỗi tin nhắn chỉ vẽ lại khi chính nó thay đổi.
- Ghim, lưu trữ, gắn nhãn… chỉ cập nhật đúng phần liên quan thay vì tính lại cả danh sách.

### An toàn hơn
- Link trong tin nhắn chỉ mở được nếu là trang web, email hoặc số điện thoại; các loại link có thể chạy chương trình trên máy bị chặn.
- Moshi chỉ đọc lại tệp trong thư mục của chính nó và không tải gì từ máy bạn hay mạng nội bộ theo yêu cầu của nội dung hiển thị.
- Cửa sổ chính chạy cô lập (sandbox) và không thể bị chuyển sang trang khác.

### Lưu ý
- Đã chạy trên Windows với dữ liệu mẫu, cả bản build thật. Các sửa lỗi Messenger được kiểm tra bằng bài kiểm tra tự động mô phỏng thư viện Messenger, chưa thử lại với tài khoản thật.

---

### English
An important fix release for 0.3.0; please update. From 0.3.0, Moshi downloads it in the background and only asks you to restart.

- **Messenger no longer marks everything as seen:** every launch used to mark all Messenger chats read, so friends saw "seen" before you opened anything. Now only reading does (and the read-receipts setting decides).
- **No more doubled Messenger messages and notifications:** disconnecting really disconnects; removing an account or signing in again no longer leaves the old connection running.
- **Lighter:** the backdrop stands still in every style (CPU while in use from about half a core to under 10%); the chat list draws only the rows on screen (tens of times faster with thousands of chats); an open chat no longer redraws for other chats' messages; pins, archives and tags update only what they touch.
- **Safer:** links from messages open only if they are web, mail or phone links; Moshi reads back files only from its own folders and never fetches from this computer or the local network on the page's behalf; the main window is sandboxed and cannot be navigated away.
- Notes: ran on Windows with sample data, including the real build. The Messenger fixes are covered by automated tests against a stand-in for the Messenger library, not yet re-tried with a real account.
