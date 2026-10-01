## Moshi 0.3.0 beta 3

Bản thử nghiệm, chủ yếu sửa lỗi cho beta 2. Bản ổn định (0.2.14) sẽ **không** tự cập nhật lên bản này; ai đang dùng beta sẽ được mời cập nhật trong app.

### Sửa lỗi
- **Ghi chú:** chuyển sang chat khác khi ô ghi chú vẫn đang được chọn không còn có thể lưu nhầm nội dung sang ghi chú của người kia.
- **Khoá bằng mã:**
  - Thoát rồi mở lại Moshi không còn xoá được thời gian chờ sau nhiều lần nhập sai.
  - Hết thời gian chờ là gõ mã được ngay, không cần bấm chuột vào cửa sổ.
  - Menu, bảng chọn giờ và thông báo nhỏ trong app không còn bấm hay chọn được phía sau màn hình khoá.
- **Hoãn hội thoại:** Chủ nhật không còn hiện hai lựa chọn trùng giờ ("Sáng mai" và "Tuần sau"); thứ Sáu có thêm "Cuối tuần".
- **Ngày sinh:** ngày không tồn tại (như 31/2) hoặc nhập thiếu ngày/tháng được báo ngay cạnh ô thay vì lặng lẽ bị bỏ.

### Nhẹ máy hơn
- Thẻ "Lâu rồi chưa nhắn" trên thanh bên không còn duyệt lại toàn bộ tin nhắn mỗi khi có tin mới.
- Phần chạy nền không còn dựng lại danh sách người đã gộp với mỗi tin nhắn (nhất là lúc đồng bộ lần đầu).

### Phía sau
- Mỗi bản phát hành giờ phải qua kiểm tra kiểu dữ liệu và kiểm tra code tự động (ESLint) trước khi build.

### Lưu ý
- Vẫn chưa thử bằng tay: trả lời từ thông báo trên máy thật, tự khoá khi máy ngủ, và bản Windows.

---

### English
**Beta**, mostly fixes for beta 2. The stable version (0.2.14) will **not** update to this one; beta users are offered the update in the app.

- **Notes:** switching chats while the note box is still focused can no longer save that text into the other person's note.
- **Passcode lock:** quitting and reopening no longer resets the wait after too many wrong codes; typing works again as soon as the wait ends; menus, the time picker and toasts can no longer be reached behind the lock screen.
- **Snooze:** no more duplicate "Tomorrow morning" / "Next week" rows on Sundays; "This weekend" is offered on Fridays.
- **Birthdays:** impossible dates (31 February) and half-filled dates are flagged next to the field instead of being dropped quietly.
- **Lighter:** the "Been a while" card no longer re-reads every stored message on each new one, and the background no longer rebuilds the merged-people list per message (notably during a first sync).
- **Behind the scenes:** every release now has to pass type checks and lint (ESLint) before it is built.
- Still not hand-tested: replying from real notifications, locking on sleep, and the Windows build.
