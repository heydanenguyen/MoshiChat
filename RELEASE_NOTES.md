## Moshi 0.3.0 beta 2

Bản thử nghiệm. Bản ổn định (0.2.14) sẽ **không** tự cập nhật lên bản này; ai đang dùng beta 1 sẽ được mời cập nhật trong app.

### Mới
- **Hoãn hội thoại:** chuột phải → *Hoãn…*, nút đồng hồ trên đầu khung chat hoặc **⌘⇧H**. Chọn *Tối nay*, *Sáng mai*, *Cuối tuần*, *Tuần sau* hay một giờ tuỳ ý. Hội thoại rời hộp thư, tới giờ (hoặc khi họ nhắn) thì quay lại đầu danh sách với nhãn *Đến hẹn*. Có nút *Hoàn tác* và mục *Đã hoãn* để xem lại.
- **Nhắc nếu chưa trả lời:** đặt giờ, nếu tới lúc đó họ vẫn im lặng thì Moshi nhắc và đưa hội thoại lên đầu với nhãn *Chưa trả lời*. Họ trả lời trước là tự huỷ.
- **Trả lời ngay trên thông báo (macOS):** gõ trả lời thẳng trong thông báo tin nhắn, hoãn, nhắc và sinh nhật; có nút *Đánh dấu đã đọc*. Tin nhắn chờ (người lạ) không trả lời từ thông báo được.
- **Ghi chú về người:** thẻ *Ghi chú* trong trang chi tiết, tự lưu khi gõ. Moshi nhắc lại ghi chú đúng lúc cần: trên thẻ nhắc, trong thông báo sinh nhật và khi gợi ý câu mở lời.
- **Nhắc sinh nhật:** thông báo lúc 9 giờ sáng đúng ngày, thẻ trên thanh bên từ hôm trước, nút *Chúc mừng* mở chat với lời chúc soạn sẵn. Ô ngày sinh giờ chỉ cần ngày và tháng, năm không bắt buộc.
- **Thẻ "Lâu rồi chưa nhắn"** thay cho *Ngày này năm xưa* trên thanh bên: chỉ hiện khi một người thân im lặng lâu hơn hẳn nhịp thường ngày, có nút *Nhắn hỏi thăm* (kèm câu mở lời từ AI trên máy nếu đã tải model) và *Để sau*. *Ngày này năm xưa* chuyển vào Thân thiết và chỉ hiện khi có tin thật từ một năm trở lên.
- **Khoá Moshi bằng mã** (Cài đặt → Chung → Bảo mật & riêng tư): mã 4–8 chữ số, tự khoá khi rời máy, khi màn hình khoá hoặc máy ngủ, khoá ngay bằng **⌃⌘L**. Lúc khoá, thông báo chỉ ghi "Có tin mới". Mã chỉ nằm trên máy này; quên mã thì cách duy nhất là đăng xuất mọi tài khoản.
- **Ẩn Moshi khi chia sẻ màn hình:** cửa sổ hiện màu đen trong Zoom, Meet và ảnh chụp màn hình.
- Công tắc mới trong Cài đặt để tắt Thân thiết, thẻ nhắc nhắn lại và nhắc sinh nhật.

### Sửa lỗi
- Sinh nhật nhập không kèm năm không còn bị xoá khi bấm Lưu trong *Tuỳ chỉnh*; *Đặt lại* không còn xoá ghi chú.

### Lưu ý
- Đã thử trên macOS với dữ liệu mẫu. Chưa thử bằng tay: trả lời từ thông báo trên máy thật, tự khoá khi máy ngủ, và cả bản Windows.
- Trên Windows chưa trả lời được từ thông báo (bấm vào vẫn mở đúng hội thoại).
- Hoãn, nhắc và khoá lưu riêng trên từng máy, không đồng bộ; Moshi cần đang chạy để nhắc đúng giờ (mở lại sau sẽ nhắc bù).

---

### English
**Beta.** The stable version (0.2.14) will **not** update to this one; beta 1 users are offered the update in the app.

- **Snooze a conversation** (right-click → *Snooze…*, the clock in the chat header or **⌘⇧H**): this evening, tomorrow morning, the weekend, next week or any time. It leaves the inbox and comes back at the top, marked *Back*, at that time or as soon as they write. Undo, and a *Snoozed* view.
- **Remind me if no reply:** if they still haven't written back by then, Moshi tells you and lifts the chat to the top, marked *No reply*. A reply cancels it.
- **Reply from notifications (macOS)** for messages, snoozes, follow-ups and birthdays, plus *Mark as read*. Message requests are never answered from a notification.
- **Notes about a person** in their details, saved as you type, brought back when they matter: on the nudge card, in birthday notifications and in suggested openers.
- **Birthday reminders:** a notification at 9 AM on the day, a sidebar card from the day before, and *Send wishes* opens the chat with a ready-made wish. Birthdays only need a day and a month.
- **"Been a while" card** replaces *On this day* in the sidebar: only when a close friend has gone quiet far longer than usual, with *Say hi* (and on-device openers when the model is installed) and *Later*. *On this day* moves into Close friends, for real anniversaries only.
- **Passcode lock** (Settings → General → Security & privacy): 4–8 digits, locks when you step away, when the screen locks or the computer sleeps, or with **⌃⌘L**. While locked, notifications only say "Something new". The code stays on this computer; forgetting it means signing out of every account.
- **Hide Moshi when sharing your screen:** the window shows up black in Zoom, Meet and screenshots.
- New Settings switches for Close friends, reconnect nudges and birthday reminders.
- **Fix:** a birthday without a year is no longer lost when saving *Customize*; *Reset* keeps your notes.
- Notes: tried on macOS with sample data; replying from real notifications, locking on sleep and the Windows build are not hand-tested yet. Replying from notifications is not available on Windows yet. Snoozes, reminders and the lock are kept per computer, and Moshi has to be running to remind you on time.
