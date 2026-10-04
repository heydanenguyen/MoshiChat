## Moshi 0.7.0

**AI gợi ý trả lời hiểu tiếng Việt hơn và viết giống bạn hơn, thêm Gmail và Slack.** Moshi tự tải bản này ở nền và chỉ hỏi bạn khởi động lại.

### AI trên máy
- **Mô hình mới, chọn theo máy:** Qwen3.5 chạy bằng llama.cpp, dùng GPU nếu máy có (NVIDIA, AMD, Intel qua Vulkan trên Windows; Metal trên Mac). Cài đặt › AI xem cấu hình máy và đề xuất 2 mô hình hợp nhất; bạn tự chọn.
- **Đúng xưng hô:** Moshi đọc đoạn chat để biết bạn xưng gì và gọi người kia là gì (em/chị, con/mẹ, tao/mày, cháu/chú…), biết khi nào cần "dạ… ạ", và giữ đúng như vậy trong gợi ý. Thử trên 30 đoạn chat mẫu: không còn câu sai xưng hô hay sai ngôn ngữ.
- **Hiểu loại tin:** tin vui, tin buồn, câu hỏi, lời nhờ, lời mời, cảm ơn, xin lỗi… mỗi loại có cách trả lời hợp. Tag, ghi chú về người đó cũng được dùng làm bối cảnh.
- **Gợi ý theo cách tôi nhắn** (mới, mặc định bật): Moshi tìm những lần bạn từng trả lời tin tương tự trên máy này rồi gợi ý đúng giọng của bạn: viết hoa hay viết thường, từ đệm, emoji, độ dài. Có thể bỏ qua chat theo tag. Không lưu thêm gì, không gửi đi đâu.
- **Giọng riêng (nâng cao):** xuất dữ liệu, chạy công cụ đi kèm (card NVIDIA hoặc Mac chip M) để dạy hẳn mô hình viết giống bạn; xong Moshi tự dùng. Tắt hoặc xoá trong Cài đặt › AI.
- **Nhanh hơn:** mô hình được nạp sẵn khi bạn mở một cuộc chat, nên lần gợi ý đầu không phải chờ.

### Kết nối mới
- **Gmail** (bằng mật khẩu ứng dụng): mỗi chuỗi thư là một cuộc trò chuyện, trả lời gửi tiếp trong chuỗi.
- **Slack** (bằng token người dùng): tin nhắn riêng và kênh, cập nhật tức thì nếu bật Socket Mode.

### Sửa lỗi
- Hai gợi ý chạy cùng lúc không còn làm hỏng nhau ("Eval has failed").

### Lưu ý
- Gmail và Slack chưa được thử bằng tài khoản thật.
- Giọng riêng cần tải thêm khoảng 12 GB (Python, PyTorch, mô hình gốc) vào thư mục bạn xuất ra.
- Bản Windows chưa được thử bằng tay.

---

### English
Moshi downloads this update in the background and only asks you to restart.

- **New on-device models, picked for your machine:** Qwen3.5 on llama.cpp, on the GPU when there is one (Vulkan on Windows, Metal on Mac). Settings › AI shows your hardware and recommends two models; you choose.
- **Vietnamese pronouns right:** Moshi reads how the two of you address each other (em/chị, con/mẹ, tao/mày…) and when to be polite, and keeps to it. On 30 sample chats: no pronoun or language slips.
- **Knows what kind of message it is:** good news, bad news, a question, a request, an invitation, thanks, an apology; your tags and note about the person count too.
- **Suggestions in my voice** (new, on by default): Moshi finds times you answered similar messages on this computer and writes like you. Skip chats by tag. Nothing extra is stored or sent.
- **Personal voice (advanced):** export, run the bundled tool (an NVIDIA card or an Apple-silicon Mac) to teach the model itself to write like you; Moshi picks it up. Turn it off or remove it in Settings › AI.
- **Quicker:** the model loads when you open a chat.
- **Gmail** (app password) and **Slack** (user token) accounts.
- **Fix:** two suggestions at once no longer break each other.
- Notes: Gmail and Slack are not tested with real accounts yet. The personal voice downloads about 12 GB (Python, PyTorch, the base model) into the folder you export to. The Windows build is not hand-tested.
