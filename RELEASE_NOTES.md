## Moshi 0.7.7

**Không còn thiếu tin Zalo khi dùng nhiều máy; cuộn chat mượt hơn; sticker không còn khung ở giao diện Liquid.** Moshi tự tải bản này ở nền và chỉ hỏi bạn khởi động lại.

### Zalo
- **Chia sẻ tin Zalo giữa các máy** (Cài đặt › Dữ liệu › Đồng bộ): Zalo chỉ cho một phiên Zalo Web, nên mở Moshi ở máy khác thì máy này bị đăng xuất và tin đến lúc đó chỉ về máy kia. Bật ở mọi máy (cùng một cụm mật khẩu) để chúng gửi cho nhau tin 21 ngày gần nhất qua thư mục đồng bộ, mã hoá AES-256; máy nào thiếu tin sẽ tự bổ sung.
- **Tự lấy bù tin chat nhóm:** sau mỗi lần kết nối, Moshi lấy tin mới nhất của các nhóm hoạt động gần đây để lấp chỗ thiếu.
- **Mở Moshi khi khởi động máy** (Cài đặt › Chung › Chạy nền): Moshi tự mở, ẩn sẵn, để Zalo luôn kết nối. Trên Windows, đóng cửa sổ thì Moshi vẫn chạy ở khay hệ thống (tắt được trong cùng mục).

### Trò chuyện
- **Cuộn lên mượt hơn ở chat nhiều sticker và ảnh:** chiều cao tin nhắn được ước lượng theo nội dung (chữ, sticker, ảnh) thay vì một con số chung, nên danh sách không còn tự chỉnh vị trí liên tục khi cuộn.
- **Sticker động trong chat nhẹ hơn:** sticker Pals hiển thị từ bản 240 px, 30 khung/giây (thay vì 384 px, 60 khung/giây), không tải lại mỗi lần cuộn tới.
- **Giao diện Liquid:** sticker, emoji lớn và tin chỉ có ảnh không còn bị bọc trong khung bong bóng.

### Lưu ý
- Chia sẻ tin Zalo chỉ lấp được tin mà máy kia còn giữ (21 ngày gần nhất) và cần cả hai máy chạy bản này. Chat 1-1 bị lỡ khi không máy nào mở Moshi thì Zalo không gửi lại.
- Các tính năng trên chưa được thử với tài khoản thật trên hai máy. Bản Windows chưa được thử bằng tay.

---

### English
- **Zalo across computers:** Zalo allows one web session, so whatever arrives while another computer holds it reached only that one. Turn on "Share Zalo messages between computers" (Settings › Data › Sync) on each, with the same passphrase: they pass each other the last 21 days of messages through the sync folder, AES-256 encrypted, and fill each other's gaps.
- **Group chats are topped up** after every connection from Zalo's per-group history.
- **Open Moshi when the computer starts** (Settings › General), hidden, so Zalo stays connected; on Windows, closing the window keeps Moshi in the tray (can be turned off).
- **Smoother scrolling up** through stickers and photos: row heights are guessed from their content, so the view no longer keeps correcting itself. Moving pack stickers are drawn from a 240 px, 30 fps copy and not reloaded on every scroll.
- **Liquid style:** stickers, big emoji and photo-only messages no longer sit in a bubble frame.
- Notes: sharing only fills what another computer still has (21 days) and needs both on this version; direct chats missed while no computer had Moshi open are not sent again by Zalo. Not yet tried with real accounts on two computers; the Windows build is not hand-tested.
