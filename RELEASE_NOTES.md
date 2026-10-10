## Moshi 0.8.0

**Gọi thoại/video ngay trong Moshi (beta), Zalo không bỏ sót tin khi máy tắt, Zalo relay cho máy luôn bật, sticker thật trên WhatsApp/Telegram, và hàng chục sửa lỗi về độ bền, hiệu năng, chuyển động.** Moshi tự tải bản này ở nền và chỉ hỏi bạn khởi động lại.

### Gọi điện (beta)
- **Nút gọi thoại và video** trong đầu mỗi chat Messenger, Instagram và Zalo cá nhân. Cuộc gọi mở trong cửa sổ Moshi; bên trong là màn hình gọi của chính nền tảng (WebRTC của họ), nên mic/camera do Moshi cấp quyền và chỉ cấp cho trang gọi trong lúc gọi.
- **Nhận cuộc gọi đến** từ Messenger và Instagram: Moshi đổ chuông, hiện banner Nghe máy/Từ chối và thông báo hệ thống; bật/tắt ở Cài đặt › Thông báo › Cuộc gọi.
- **Zalo:** Zalo chỉ cho một phiên web, nên trong lúc gọi Moshi tạm nhường phiên cho cửa sổ gọi rồi nối lại sau; vì thế Zalo chỉ gọi đi, cuộc gọi Zalo đến vẫn đổ chuông trên điện thoại.
- "Nhận cuộc gọi Messenger" đang bật sẵn: Moshi giữ một trang Messenger ẩn (khoảng 100–200 MB RAM) để nghe chuông; tắt được trong Cài đặt › Thông báo › Cuộc gọi nếu bạn không cần.
- Lưu ý: chưa thử với tài khoản thật; nếu nút gọi không bấm được trên trang, Moshi giữ cửa sổ mở để bạn bấm tay. Instagram web có thể không hỗ trợ gọi với mọi tài khoản.

### Zalo
- **Lấy bù đủ tin đã lỡ khi Moshi tắt:** lần quét sau khi mở lại nhớ nhiều khoảng trống (mới nhất trước), đi tiếp quá 60 trang khi vẫn toàn tin mới, nên tắt lâu hay tắt nhiều lần không còn bỏ sót. Tin lỡ được tính vào số chưa đọc.
- **Kết nối bền:** socket rớt vì lý do khác đăng xuất được nối lại với thời gian chờ tăng dần; sau 16 lần thất bại mà Zalo từ chối phiên mới báo "đăng nhập lại" thay vì quay mãi. Lỗi API tạm thời lúc đăng nhập không còn làm mất phiên và bắt quét QR.
- **Zalo relay** (Cài đặt › Dữ liệu › Đồng bộ): một máy luôn bật giữ phiên Zalo và chuyển tin mã hoá qua thư mục đồng bộ; máy khác đọc và gửi Zalo qua máy đó mà không cần phiên riêng (độ trễ 20–60 giây). Chưa thử với tài khoản thật.
- Voice Zalo gửi dạng tin thoại nghe được; vị trí, danh thiếp, bình chọn hiện chữ thay vì bubble trống.

### Gửi và nhận
- **Sticker thật trên WhatsApp và Telegram** (WebP trong suốt 512 px, động nếu sticker động), thay vì ảnh nền trắng tĩnh; lần gửi đầu mỗi sticker khoảng 2 giây.
- Gửi lỗi thì có **Gửi lại / Xoá**, không mất nội dung. Voice đang ghi ở chat này không còn gửi nhầm sang chat khác. Picker GIF nhận key có sẵn. Tìm emoji bằng chữ tiếng Việt/Anh, không dấu cũng được. Sticker nhận từ WhatsApp/Telegram hiện hình thay vì chữ "Sticker".

### Tài khoản và dữ liệu
- Tài khoản không kết nối được (mở máy trước Wi-Fi, server chập) tự thử lại 30 giây → 10 phút và ngay khi máy thức/mạng về; lỗi mật khẩu không bị thử vô tận.
- Settings không còn bị kẹt sau một lần Windows giữ file; file hỏng được giữ lại và khôi phục từ bản sao, có thông báo. Khoá ứng dụng không tự mở khi không đọc được file khoá. Xoá tài khoản Facebook/Instagram cá nhân xoá cả cookie.
- Thả file ra ngoài vùng đính kèm không còn thay thế cả cửa sổ; file đính kèm dạng thực thi mở thư mục thay vì chạy.

### Hiệu năng và chuyển động
- Cuộn mượt hơn (bộ zoom không chặn cuộn; cuộn lên từ tin mới nhất không còn bị kéo ngược); chat đang mở không vẽ lại khi chat khác có tin; danh sách không vẽ lại khi ai đó gõ; composer giãn bằng CSS; ~450 dòng CSS thừa bị xoá.
- Mọi sheet, menu, picker, toast, lightbox có chuyển động đóng; hàng chat trượt lên vị trí mới; chuyển list↔chat ở cửa sổ hẹp, thu sidebar, mở Details dùng View Transitions. Sheet giữ focus và trả focus; menu chuột phải điều khiển bằng bàn phím; Enter không cắt từ đang gõ Telex.

---

### English
- **Calls (beta):** voice/video buttons in Messenger, Instagram and Zalo chats; the platform's own call screen runs inside a Moshi window, with mic/camera granted only to that page during the call. Incoming Messenger/Instagram calls ring in Moshi with Answer/Decline (Settings › Notifications › Calls). Zalo is outgoing only (single web session). "Receive Messenger calls" is on by default and keeps a hidden Messenger page (~100–200 MB); switch it off in Settings › Notifications › Calls. Not yet tried with real accounts.
- **Zalo catches up on everything it missed** while Moshi was closed (multi-gap resume, keeps walking while pages are still new, missed messages count as unread); dead sockets reconnect with back-off; a refused session surfaces "sign in again". **Zalo relay:** an always-on computer holds the session and passes encrypted messages through the sync folder; other computers read and send through it. Voice notes play; locations, contact cards and polls show as text.
- **Real stickers on WhatsApp and Telegram** (512 px transparent WebP, animated when the source moves). Failed sends offer Send again / Delete; a voice note never goes to the wrong chat; the GIF picker uses the built-in key; emoji search understands Vietnamese and English words.
- **Accounts reconnect on their own** (30 s → 10 min, and on resume/network return); credential errors are not retried forever. Settings survive a locked or corrupt file; the app lock fails closed; removing a personal Facebook/Instagram account clears its cookies; dropped files cannot replace the app; executable attachments open their folder.
- **Smoother**: scrolling no longer waits on the zoom handler or snaps back near the bottom; fewer re-renders; CSS trimmed; every overlay animates out; list rows glide; View Transitions for narrow mode, sidebar and details; focus trapping; keyboard menus; IME-safe Enter.

---

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
