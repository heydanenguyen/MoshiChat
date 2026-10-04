## Moshi 0.7.2

**Luyện giọng riêng cho Gemma 4 12B chạy được.** Moshi tự tải bản này ở nền và chỉ hỏi bạn khởi động lại.

### Sửa lỗi
- **Luyện giọng riêng cho Gemma 4 12B:** công cụ đi kèm không còn báo "No usable samples". Đã chạy thử trọn vẹn trên GTX 1080 Ti (11 GB): khoảng 25 phút cho 200 mẫu, rồi Moshi nạp được giọng mới.
- Nếu bạn đã xuất dữ liệu luyện Gemma bằng bản 0.7.1, hãy xuất lại để lấy công cụ mới.

### Lưu ý
- Gmail và Slack chưa được thử bằng tài khoản thật. Bản Windows chưa được thử bằng tay.

---

### English
Moshi downloads this update in the background and only asks you to restart.

- **Fix:** the bundled tool now trains a personal voice for Gemma 4 12B (it stopped with "No usable samples"). Tested end to end on a GTX 1080 Ti (11 GB): about 25 minutes for 200 samples, and Moshi loads the result. If you exported Gemma training data with 0.7.1, export again for the new tool.
- Notes: Gmail and Slack are not tested with real accounts. The Windows build is not hand-tested.
