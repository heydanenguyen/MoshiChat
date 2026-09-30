## Moshi 0.2.14

### Mới
- **Thân thiết làm mới hoàn toàn:** bạn ở giữa một "quỹ đạo", ai càng thân càng đứng gần. Thẻ tổng kết kiểu Wrapped cho số tin nhắn, giờ vàng kèm danh hiệu (Chim sớm, Cú đêm chính hiệu…) và chuỗi ngày liên tiếp. Top 3 đứng trên bục vinh danh vàng, bạc, đồng. Mỗi người còn có "vibe" riêng: cú đêm, hay ai là người nhắn nhiều hơn, cùng thanh cân bằng mang màu nhân vật logo bạn chọn.
- **⌘K / Ctrl+K chạy được lệnh:** ngoài nhảy tới chat còn có tin nhắn mới, lưu trữ, đánh dấu đọc/chưa đọc, ghim, tắt thông báo, đổi sáng/tối, Liquid Glass, chia đôi khung chat, cài đặt… Gõ không dấu cũng tìm ra; gõ `>` để chỉ tìm lệnh.
- **Liquid Glass làm lại:** kính được vẽ ngay trong app với độ mờ thật, viền sáng và sidebar thành một tấm kính nổi, giống macOS mới. Trên Windows hết hẳn các vệt chữ cũ, dải trắng và nền xám đục.
- **Nhẹ máy hơn:** khi Moshi nằm dưới cửa sổ khác, các hiệu ứng trang trí tạm dừng (đo được từ hơn một nhân CPU xuống khoảng 1%). Liquid Glass để nền đứng yên.
- Tắt *Transparency effects* của Windows (hoặc *Reduce transparency* trên macOS) thì mọi bề mặt kính chuyển sang màu đặc.
- **Riêng tư hơn:** mã OTP được che (••••••) trong danh sách chat và ⌘K. Thời tiết trên thanh tiêu đề thành tuỳ chọn *Thời tiết nơi bạn ở* trong Cài đặt › Chung, vì cần ước lượng vị trí qua IP. Máy đang bật lời chào thì vẫn giữ như cũ.
- Trên Windows, nút thu nhỏ, phóng to và đóng nằm ở góc phải như các app khác.

### Giao diện
- Chữ phụ (giờ, "Đã xem", nhãn) đậm hơn, dễ đọc hơn ở cả nền sáng và tối.
- Sidebar thu thành thanh icon vẫn hiện chấm tin chưa đọc; khi tự thu lúc mở chi tiết, nó trông y như khi bạn tự thu gọn.
- Mép cuộn mờ dần ở sidebar, danh sách chat, khung chat và phần chi tiết.
- Danh sách chat gọn hơn: bỏ vòng màu quanh avatar, nút "…" hiện đúng chỗ của giờ, chat đã tắt thông báo có số chưa đọc màu xám.
- Reaction không còn viền, treo nhẹ ở mép tin nhắn.
- Thẻ *Cùng một người trên…?* thiết kế lại, nút *Gộp* có hiệu ứng mời bấm.
- Tab trong phần chi tiết hiện tên tab đang mở. Hàng lọc nhanh có mũi tên khi không đủ chỗ.
- Sticker chạy liên tục khi đang trên màn hình và không còn co giật khi rê chuột. Sticker Mito nhảy dây mượt hơn.

### Sửa lỗi
- Khung chat không còn cuộn ngang được khi rê chuột qua tin nhắn.
- Lúc chưa kết nối tài khoản, thanh tiêu đề không còn chúc mừng "hộp thư trống".
- File đính kèm mở được bằng bàn phím.

### Cũng có trong bản này (từ 0.2.13, chưa phát hành riêng)
- **Lọc nhanh trên danh sách chat:** Tất cả, Chưa đọc, Cần trả lời, Nhóm và Nháp, mỗi mục kèm số đếm. "Cần trả lời" gom các chat mà người kia nhắn sau cùng trong 30 ngày qua.
- **Đánh dấu chưa đọc** (⌘⇧U / Ctrl+Shift+U, hoặc chuột phải vào chat) để nhớ quay lại trả lời sau.
- **Lưu trữ kiểu "xong việc"** (⌘E / Ctrl+E): chat biến khỏi hộp thư và tự quay lại khi người kia nhắn tiếp. Chat đã tắt thông báo thì nằm yên trong lưu trữ. Mở lưu trữ bằng ⌘; / Ctrl+; hoặc nút hộp lưu trữ trên đầu danh sách chat, cạnh nút soạn tin mới. Lưu trữ nhầm thì bấm *Hoàn tác*.
- **Nhóm chỉ báo khi được nhắc tên:** bật trong phần chi tiết nhóm. Moshi chỉ báo khi có người @tên bạn (có dấu hay không dấu đều nhận), @all, hoặc trả lời tin của bạn.
- **Tin nhắn chờ:** tin từ người lạ trên Messenger, Instagram và Zalo được xếp riêng, không báo và không bị đánh dấu đã xem cho đến khi bạn *Chấp nhận* hoặc trả lời. Mã OTP/mã xác thực vẫn báo ngay.
- **Gộp một người trên nhiều app:** chuột phải vào chat › *Gộp với…* để nhập các cuộc trò chuyện Zalo, Messenger, Instagram… của cùng một người thành một. Moshi gợi ý người trùng số điện thoại hoặc tên giống. Tin nhắn của mọi app hiện chung một dòng thời gian. Tin trả lời mặc định đi qua app mà người đó nhắn bạn gần nhất; bấm chip *Gửi qua* cạnh ô soạn để đổi. Tách ra lại được trong phần chi tiết.
- Chat đã gộp dùng chung cho AI tóm tắt và gợi ý trả lời, tìm trong chat, ảnh và file đã chia sẻ, Thân thiết và nhảy tới tin cũ.

### Lưu ý
- Tin nhắn chờ trên Instagram, Messenger và Zalo cần kiểm tra thêm với tài khoản thật. Nếu thấy chat quen bị xếp nhầm vào Tin nhắn chờ, bấm *Chấp nhận* là xong.
- Kết quả tìm kiếm toàn bộ vẫn hiện tên từng chat riêng lẻ, chưa hiện tên người đã gộp.

---

### English
- **Close friends, reimagined:** you at the centre of an orbit, closer friends nearer; Wrapped-style cards for your messages, your golden hour as a character and your streak on fire; a gold, silver and bronze podium for your top 3; each friendship's vibe (night owls, who carries the chat) with a balance bar in your logo character's colour.
- **⌘K / Ctrl+K runs commands** as well as jumping to chats (new message, archive, read/unread, pin, mute, light/dark, Liquid Glass, split, settings…). Matching ignores Vietnamese marks; start with `>` for commands only.
- **Liquid Glass rebuilt:** real glass drawn inside the app, bright rims and a floating glass sidebar. On Windows the ghost text, white bands and murky grey backdrop are gone.
- **Lighter:** decorative motion rests while Moshi is in the background (from over a full CPU core to about 1% in our measurements); the Liquid Glass backdrop stays still.
- Windows *Transparency effects* off (or macOS *Reduce transparency*) turns every glass surface solid.
- **Privacy:** one-time codes are masked in the chat list and ⌘K. The title-bar weather is now opt-in (*Local weather* in Settings › General) since it estimates your location from your IP; existing installs with greetings on keep it.
- Windows caption buttons (minimise, maximise, close) sit on the right like other apps.
- Interface: stronger secondary text; unread dots on the icon rail, and the automatic rail looks exactly like the folded sidebar; soft scroll edges; a tidier chat list (no avatar rings, "…" in the time's spot, grey counts on muted chats); borderless reactions; a redesigned *Same person on…?* card; labelled details tabs; arrows on overflowing quick filters; stickers keep playing while on screen without flickering on hover, and the Mito skipping-rope sticker is smoother.
- Fixes: the chat no longer scrolls sideways when hovering messages; no "inbox zero" before any account is connected; file attachments open from the keyboard.
- Also in this release (0.2.13 was never published on its own): quick filters, mark unread, archive as "done", mentions-only groups, message requests, and one person across apps. Message requests still need checking against real accounts; global search hits still show each chat's own name.
