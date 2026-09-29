## Moshi 0.2.7

### Mới
- **Tắt bớt nút trên thanh hành động.** Cài đặt → Chat → *Thao tác trên tin nhắn*: bật/tắt từng nút (cảm xúc, trả lời, chuyển tiếp, dịch, đọc to, việc cần làm, lưu) để thanh hiện khi rê chuột gọn hơn.

### Cải thiện
- **Thanh hành động nằm sát bong bóng.** Hàng tin đến không còn giãn bằng tin dài nhất trong nhóm, nên các nút luôn cách bong bóng vài pixel ở cả hai chiều; trong pane hẹp thanh nằm ngay góc trên của bong bóng.
- **Chọn nhắc việc từ tin nhắn** không còn biến mất khi rời chuột: thanh giữ nguyên khi picker đang mở, picker mở về phía bong bóng, tự lật xuống dưới khi sát mép trên và không bị cắt ở mép cột chat.

### Sửa
- **Sticker Zalo** hiện đúng hình thay vì ô "Sticker" trống: app tra ảnh theo id sticker một lần rồi nhớ lại.
- **Ảnh Zalo** tải lỗi sẽ tự thử lại qua proxy của app; vẫn lỗi thì hiện ô "Ảnh" thay cho icon vỡ.
- **Giao diện Liquid:** mở emoji / sticker / GIF không còn làm ô soạn tin phình to.

---

### English
- Settings → Chat → Message actions: switch off the buttons you never use so the hover bar stays short.
- The hover action bar now sits right beside the bubble on both sides; in a narrow pane it sits over the bubble's top corner.
- The to-do "remind me" picker no longer vanishes when the mouse moves: the bar stays while it is open, it opens on the bubble's side, flips below near the top and stays inside the chat column.
- Zalo stickers show their picture (looked up once by id and cached) instead of an empty "Sticker" box.
- Zalo photos that fail to load retry through the app's image proxy, then fall back to a placeholder.
- Liquid style: opening the emoji, sticker or GIF picker no longer inflates the composer.
