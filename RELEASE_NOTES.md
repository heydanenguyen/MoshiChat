## Moshi 0.7.1

**Gửi tin Facebook được trở lại, thêm Gemma 4 12B cho máy mạnh, và luyện giọng không còn làm máy ì.** Moshi tự tải bản này ở nền và chỉ hỏi bạn khởi động lại.

### Sửa lỗi
- **Facebook cá nhân:** gửi tin không còn báo "reply was never sent". Moshi gọi hàm gửi của thư viện Facebook sai kiểu nên lần gửi nào cũng treo.

### AI trên máy
- **Gemma 4 12B** (mới): viết tiếng Việt tự nhiên nhất và ít nhầm vai nhất trong các mô hình đã thử, chậm hơn khoảng gấp đôi. Dành cho máy có GPU từ 10 GB hoặc Mac 16 GB; Cài đặt › AI sẽ đề xuất nếu máy bạn chạy được.
- **Trong lúc luyện giọng riêng**, Moshi tạm ngưng tự gợi ý và không nạp sẵn mô hình, để nhường GPU (bấm gợi ý vẫn được). Cài đặt › AI hiện "Đang luyện…".
- **Công cụ luyện giọng nhẹ hơn khoảng 4 GB bộ nhớ GPU**, đủ để luyện mô hình lớn trên card 11 GB, và chỉ học phần chữ của mô hình.

### Lưu ý
- Luyện giọng riêng cho Gemma 4 12B chưa được chạy thử trọn vẹn; cần khoảng 30 GB trống.
- Gmail và Slack chưa được thử bằng tài khoản thật. Bản Windows chưa được thử bằng tay.

---

### English
Moshi downloads this update in the background and only asks you to restart.

- **Fix:** sending on personal Facebook no longer fails with "reply was never sent" (Moshi called the Facebook library's send the wrong way, so every send hung).
- **Gemma 4 12B** (new): the most natural Vietnamese and the fewest mix-ups of who is speaking in our tests, at about twice the time per suggestion. For a GPU with 10 GB or more, or a 16 GB Mac; Settings › AI recommends it when your machine runs it.
- **While a personal voice trains**, Moshi pauses automatic suggestions and does not load its model ahead, leaving the GPU to the training (asking still works). Settings › AI shows "Training…".
- **The voice trainer needs about 4 GB less GPU memory**, enough for larger models on an 11 GB card, and only trains the text part of the model.
- Notes: training a personal voice for Gemma 4 12B is not tested end to end yet and needs about 30 GB free. Gmail and Slack are not tested with real accounts. The Windows build is not hand-tested.
