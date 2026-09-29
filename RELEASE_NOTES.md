## Moshi 0.2.10

### Mới
- **Dùng Moshi trên nhiều máy.** Vào Cài đặt → Dữ liệu & pháp lý → *Đồng bộ giữa các máy*, chọn một thư mục mà OneDrive, Google Drive hoặc Dropbox đang đồng bộ, rồi chọn đúng thư mục đó trên máy kia. Các máy sẽ dùng chung: tag, ghim, biệt danh, ảnh đại diện riêng, tin đã lưu, việc cần làm, câu trả lời nhanh, chat đã ẩn và giao diện. Sửa trên hai máy cùng lúc (ở các chat khác nhau) thì giữ được cả hai. Mỗi máy vẫn giữ riêng phiên đăng nhập, tin hẹn giờ, cỡ chữ và thu phóng. Không cần máy chủ; dữ liệu đồng bộ nằm trong thư mục bạn chọn và không được mã hóa.

### Cải thiện
- **Zalo tự tải tin nhắn cũ sâu hơn:** mỗi lần mở app, Moshi tải tiếp từ chỗ lần trước dừng cho đến khi Zalo hết tin cũ, thay vì chỉ lấy vài trang gần nhất. Mỗi chat giữ tối đa 1000 tin (trước đây 300).

### Sửa
- **Zalo bị đăng xuất do đăng nhập ở máy khác:** bấm *Đăng nhập lại* giờ hiện mã QR mới để quét, thay vì chỉ nháy rồi không làm gì. Phiên cũ bị Zalo từ chối cũng chuyển sang quét QR. Quét bằng một tài khoản Zalo khác sẽ được báo rõ, và nếu đăng nhập lỗi thì app hiện lý do.
- Lưu ý: Zalo chỉ cho một phiên web tại một thời điểm, nên đăng nhập Zalo trên máy này sẽ làm máy kia bị đăng xuất khỏi Zalo.

---

### English
- Sync between computers (Settings → Data & legal): pick a folder OneDrive, Google Drive or Dropbox already syncs, then the same folder on the other computer. Tags, pins, nicknames, custom photos, saved messages, to-dos, quick replies, hidden chats and the look stay alike; sign-ins, scheduled messages, text size and zoom stay per computer. No server; the synced data sits unencrypted in that folder.
- Zalo history goes deeper on its own: each start continues where the last one stopped until Zalo has nothing older. Up to 1000 messages per chat are kept (was 300).
- After being signed out of Zalo by another computer, "Sign in again" shows a new QR code instead of flickering. A session Zalo rejects asks for a QR, scanning with a different Zalo account is explained, and failed sign-ins show why.
- Zalo allows one web session at a time, so signing in to Zalo on one computer signs the other out of Zalo.
