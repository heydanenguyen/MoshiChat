MOSHI · GIỌNG RIÊNG CỦA BẠN (LoRA)
==================================

Thư mục này chứa các lần bạn trả lời tin nhắn (data/train.jsonl) do Moshi xuất ra, và công cụ để dạy mô hình AI
viết giống bạn. Mọi thứ chạy trên máy này; tin nhắn không gửi đi đâu.

Cách dùng
  Windows: bấm đúp run-windows.cmd
  Mac:     bấm đúp run-mac.command (lần đầu: chuột phải > Open)

Công cụ tự cài Python riêng trong thư mục work (không đụng vào máy), tải mô hình gốc (vài GB), huấn luyện, rồi
chép kết quả vào Moshi. Lần gợi ý tiếp theo Moshi dùng giọng của bạn. Tắt hoặc xoá trong
Cài đặt > AI > Giọng của bạn.

Cần gì
  - Card NVIDIA (từ GTX 10xx) hoặc Mac chip Apple M. Không có thì vẫn chạy bằng CPU nhưng rất lâu.
  - Khoảng 15 GB trống cho mô hình gốc và thư viện (nằm trong work; xoá thư mục này là sạch).
  - Ít nhất 50 lần trả lời; vài trăm trở lên thì tốt hơn.
  - Thời gian: mô hình 4B trên GTX 1080 Ti khoảng 30–90 phút cho 1.000 mẫu.

Lưu ý
  - Dữ liệu đã bỏ các tin trông như số tài khoản, số điện thoại, mã OTP, mật khẩu, email, đường link.
    Bạn có thể mở data/train.jsonl để xem và xoá dòng nào không muốn trước khi chạy.
  - Giọng riêng chỉ hợp với đúng mô hình đã chọn lúc xuất (ghi trong meta.json). Đổi mô hình thì xuất và luyện lại.
  - Giữ kín thư mục này: nó chứa tin nhắn của bạn. Xong việc có thể xoá cả thư mục.


MOSHI · YOUR PERSONAL VOICE (LoRA)
==================================

This folder holds your replies (data/train.jsonl), exported by Moshi, and a tool that teaches the AI model to
write like you. Everything runs on this computer; your messages go nowhere.

  Windows: double-click run-windows.cmd
  Mac:     double-click run-mac.command (first time: right-click > Open)

It sets up a private Python inside "work", downloads the base model (a few GB), trains, and copies the result
into Moshi, which uses it from the next suggestion. Turn it off or remove it in Settings > AI > Your voice.

Needs an NVIDIA card (GTX 10xx or newer) or an Apple-silicon Mac (a CPU works, very slowly), about 15 GB free,
and at least 50 replies. Lines that look like account numbers, phone numbers, codes, passwords, emails or links
were left out; open data/train.jsonl to check or delete lines first. Keep this folder private, or delete it
when done.
