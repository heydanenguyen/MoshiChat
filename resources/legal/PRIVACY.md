# Chính sách riêng tư Moshi

*Bản nháp – cập nhật 27/09/2026. English below.*

## Tóm tắt

Moshi không thu thập dữ liệu của bạn. Không có tài khoản Moshi, không có máy chủ Moshi, không có thống kê sử dụng, không có quảng cáo. Mọi thứ nằm trên máy của bạn.

## Dữ liệu nào được lưu trên máy bạn

Trong thư mục dữ liệu của ứng dụng (`%APPDATA%\Moshi` trên Windows):

- **Phiên đăng nhập** của từng tài khoản (cookie, khoá phiên), được mã hoá bằng cơ chế bảo vệ của hệ điều hành (DPAPI trên Windows).
- **Bộ nhớ đệm tin nhắn** của các cuộc trò chuyện gần đây, để mở nhanh khi khởi động lại.
- **Cài đặt** của bạn: ngôn ngữ, âm thanh, biệt danh, ảnh đại diện tuỳ chỉnh, hình nền, câu trả lời nhanh, tin nhắn hẹn giờ, tin đã lưu, bản nháp.
- **Mô hình AI** bạn chọn tải về và bộ nhớ đệm kết quả (bản chép lời, bản dịch) để không phải tính lại.

Bạn xoá được tất cả bằng cách gỡ ứng dụng và xoá thư mục trên.

## Dữ liệu đi đâu

- **Tới các nền tảng bạn kết nối** (Meta, Telegram, VNG/Zalo, WhatsApp): đúng những gì cần để đăng nhập, nhận và gửi tin, như khi bạn dùng trình duyệt hoặc ứng dụng gốc. Chính sách riêng tư của từng nền tảng áp dụng cho phần này.
- **Tới máy chủ mô hình (Hugging Face)** chỉ khi bạn bấm tải mô hình AI. Sau khi tải, mọi xử lý giọng nói và dịch diễn ra trên máy bạn, không gửi nội dung tin nhắn đi đâu.
- **Tới dịch vụ GIF** khi bạn tìm GIF: chỉ gửi từ khoá tìm kiếm.
- **Không gửi gì cho tác giả Moshi.** Moshi không có máy chủ, không thống kê, không báo lỗi tự động.

## Sao lưu

Tệp sao lưu `.unisonbackup` do bạn tạo, lưu ở nơi bạn chọn, được mã hoá bằng mật khẩu của bạn (AES-256-GCM, scrypt). Tệp này chứa phiên đăng nhập của các tài khoản, nên ai có tệp và mật khẩu sẽ truy cập được tài khoản của bạn. Hãy giữ tệp và mật khẩu cẩn thận. Moshi không giữ bản sao nào.

## Quyền truy cập hệ thống

Moshi dùng micro chỉ khi bạn ghi tin nhắn thoại, và đọc tệp chỉ khi bạn chọn tệp để gửi hoặc để sao lưu, khôi phục.

## Trẻ em

Moshi không dành cho người dưới độ tuổi tối thiểu mà các nền tảng được kết nối yêu cầu.

## Liên hệ và thay đổi

Chính sách này có thể được cập nhật cùng các phiên bản mới của Moshi. Câu hỏi về quyền riêng tư: liên hệ qua trang dự án.

---

# Moshi Privacy Policy

*Draft – updated 27 September 2026.*

## In short

Moshi does not collect your data. There is no Moshi account, no Moshi server, no usage analytics, no advertising. Everything stays on your computer.

## What is stored on your computer

In the app's data folder (`%APPDATA%\Moshi` on Windows):

- **Sessions** for each account (cookies, session keys), encrypted with the operating system's protection (DPAPI on Windows).
- **A message cache** of recent conversations, so they open instantly after a restart.
- **Your settings**: language, sounds, nicknames, custom photos, wallpapers, quick replies, scheduled messages, saved messages, drafts.
- **AI models** you chose to download, and a cache of their results (transcripts, translations) so they are not computed twice.

You can delete all of it by uninstalling the app and removing that folder.

## Where data goes

- **To the platforms you connect** (Meta, Telegram, VNG/Zalo, WhatsApp): exactly what is needed to sign in, receive and send messages, as when you use their browser or desktop clients. Each platform's own privacy policy applies to that part.
- **To the model host (Hugging Face)** only when you choose to download an AI model. After that, all speech and translation processing happens on your computer; message content is never sent anywhere.
- **To the GIF service** when you search for GIFs: only your search words.
- **Nothing to the authors of Moshi.** Moshi has no server, no analytics and no automatic error reporting.

## Backups

A `.unisonbackup` file is created by you, saved where you choose, and encrypted with your password (AES-256-GCM, scrypt). It contains your account sessions, so anyone with the file and the password can access your accounts. Keep both safe. Moshi keeps no copy.

## System access

Moshi uses the microphone only while you record a voice message, and reads files only when you pick them to send, or to back up and restore.

## Children

Moshi is not intended for anyone below the minimum age required by the connected platforms.

## Contact and changes

This policy may be updated together with new versions of Moshi. Privacy questions: contact us through the project page.
