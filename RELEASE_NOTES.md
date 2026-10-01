## Moshi 0.3.0 beta 1

Bản thử nghiệm. Bản ổn định (0.2.14) sẽ **không** tự cập nhật lên bản này; muốn thử thì tải bộ cài bên dưới. Gặp lỗi gì cứ báo, bản 0.3.0 chính thức sẽ sửa.

### Mới
- **Chia sẻ Thân thiết thành ảnh story:** nút *Chia sẻ* trong Thân thiết tạo một ảnh dọc 1080 × 1920 (quỹ đạo bạn bè, tổng số tin, giờ vàng, chuỗi và bục vinh danh top 3). Ảnh được lưu vào thư mục tải về và sao chép sẵn, dán thẳng vào story Instagram, Facebook, Zalo là xong.
- **Nền tảng mới: Electron 44 (Chromium 152).** Bản cũ (Electron 33) đã hết được vá bảo mật; bản này đóng các lỗ hổng của Electron và trình giải nén đi kèm, và Chromium bên trong (phần hiển thị nội dung người khác gửi tới) được cập nhật mới nhất.

### Nhẹ máy hơn
- Logo nháy mắt ở góc sidebar chỉ chuyển động đúng lúc nháy, không vẽ lại liên tục nữa. Khi đang dùng Moshi với Liquid Glass, mức dùng CPU giảm khoảng một nửa trong đo đạc của chúng tôi.

### Sửa lỗi
- Thân thiết không còn xếp *Saved Messages* (chat với chính mình) hay những chat chưa từng hồi âm vào danh sách người thân.

### Lưu ý
- Đây là bản beta: trên Windows, app đã chạy với dữ liệu mẫu và các thành phần AI trên máy đã nạp được, nhưng đăng nhập tài khoản thật, sao lưu và AI với model thật chưa được thử lại trên nền tảng mới; macOS chưa được thử.
- Thư viện Messenger cá nhân (ws3-fca) vẫn còn vài lỗ hổng trong các gói nó dùng; chưa có bản vá tương thích. Mức rủi ro thấp vì chúng chỉ xử lý dữ liệu trả về từ máy chủ Facebook.

---

### English
**Beta.** The stable version (0.2.14) will **not** update to this one; download the installer below to try it. Please report anything odd before 0.3.0.

- **Share Close friends as a story picture:** the *Share* button makes a 1080 × 1920 image (your orbit, message count, golden hour, streak and top-3 podium), saved to your downloads and copied, ready to paste into an Instagram, Facebook or Zalo story.
- **New foundation: Electron 44 (Chromium 152).** Electron 33 no longer gets security fixes; this closes the advisories against Electron and its unzip helper and brings the newest Chromium, which renders what other people send you.
- **Lighter:** the blinking logo in the sidebar only moves while it blinks; with Liquid Glass in use, CPU use roughly halved in our measurements.
- **Fix:** Close friends no longer counts Saved Messages (your chat with yourself) or chats that never wrote back.
- Notes: on Windows the app ran with sample data and the on-device AI components load, but real sign-ins, backups and AI with real models have not been re-tested on the new foundation; macOS is untested. The personal Messenger library (ws3-fca) still pulls in a few packages with advisories and no compatible fix; exposure is low, they only handle Facebook's own responses.
