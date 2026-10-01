## Moshi 0.3.0 beta 6

Bản thử nghiệm. Bản ổn định (0.2.14) sẽ **không** tự cập nhật lên bản này; ai đang dùng beta sẽ được mời cập nhật trong app.

### Sticker GIPHY
- **Tab mới ✨ trong khung sticker:** tìm và gửi sticker GIPHY, đúng kho sticker mà Instagram dùng. Có danh sách thịnh hành và các chủ đề nhanh (Haha, Yêu, Ôm…). Cần một key GIPHY miễn phí (loại API): dán ngay trong tab, hoặc dùng key GIPHY đã đặt cho GIF.
- **Gửi sang Instagram như sticker thật:** Moshi chọn sticker trong khung GIF và sticker của chính instagram.com, nên người nhận thấy sticker động, nền trong suốt như gửi từ app Instagram.
- **Sang các app khác:** Messenger và Zalo nhận sticker động trong suốt; Telegram và WhatsApp nhận ảnh tĩnh nền trắng.
- **"Bạn bè gửi":** sticker GIPHY bạn bè gửi được giữ lại trong tab để gửi lại một chạm.
- **Mito trên GIPHY:** cả 12 sticker Mito đã có trên GIPHY. Khi GIPHY duyệt kênh, sticker Mito gửi qua Instagram sẽ tự thành sticker động; trước đó vẫn là ảnh tĩnh nền trắng như cũ.

### Tự cập nhật
- Bản mới giờ **tự tải ở nền**; xong chỉ hiện "khởi động lại để cập nhật", hoặc bản mới tự cài khi bạn tắt Moshi. Tắt được ở Cài đặt → Chung → Cập nhật.
- Riêng lần lên bản này, bản beta cũ vẫn hỏi bạn bấm **Cập nhật** một lần. Trên macOS (chưa ký với Apple) Moshi vẫn mở trang tải về như trước.

### Lưu ý
- Gửi sticker qua khung sticker của Instagram **chưa thử với tài khoản thật**: Moshi bấm giao diện của instagram.com, và giao diện đó có thể khác dự đoán. Nếu không được, Moshi báo lỗi rõ ràng và ghi nhật ký; hãy gửi nhật ký để sửa.
- Tab GIPHY và gửi sang chat demo đã chạy trên Windows với dữ liệu mẫu; tự tải cập nhật được kiểm tra bằng bài kiểm tra tự động, chưa qua một lần cập nhật thật.

---

### English
**Beta.** The stable version (0.2.14) will **not** update to this one; beta users are offered the update in the app.

- **GIPHY stickers:** a new ✨ tab in the sticker picker searches GIPHY, the library behind Instagram's sticker tray, with trending and quick moods. Needs a free GIPHY key (API type), pasted in the tab or reused from a GIPHY GIF key.
- **Real stickers on Instagram:** Moshi picks the sticker in instagram.com's own GIF and sticker tray, so it arrives moving and see-through, as if sent from the Instagram app. Messenger and Zalo get it moving and see-through too; Telegram and WhatsApp get the still on white.
- **From friends:** GIPHY stickers friends send you are kept in the tab to send back in one tap.
- **Mito on GIPHY:** all 12 Mito stickers are on GIPHY; once GIPHY approves the channel, Mito stickers sent to Instagram become real moving stickers (until then, the still on white as before).
- **Automatic updates:** new versions download in the background and Moshi only asks you to restart (or installs on quit). Can be turned off in Settings → General → Updates. Getting to this version, an older beta still asks for one click; unsigned macOS builds still open the download page.
- Notes: sending through Instagram's sticker tray is **not yet tried with a real account** (it drives instagram.com's interface, which may differ from what Moshi expects); a failure says so and is logged. The GIPHY tab and sending to a demo chat ran on Windows with sample data; background updates are covered by automated tests, not yet by a real update.
