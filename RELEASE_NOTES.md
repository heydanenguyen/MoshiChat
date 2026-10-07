## Moshi 0.7.5

**Cập nhật không còn kẹt ở "Moshi không thể đóng".** Lần này hãy tải và chạy bộ cài 0.7.5; từ bản này trở đi, cập nhật trong app chạy bình thường.

### Sửa lỗi
- **Cập nhật kẹt ở "Moshi không thể đóng – vui lòng đóng thủ công":** bộ cài dò "Moshi còn chạy" theo thư mục cài và báo sai cả khi Moshi đã tắt; giờ nó tìm đúng chương trình Moshi, tự đóng (nhẹ trước, rồi buộc tắt) và chờ đủ lâu trước khi hỏi bạn.
- **Moshi tắt hẳn trước khi cài:** khi bấm cập nhật (và khi thoát lúc có bản cập nhật chờ sẵn), Moshi chờ phần AI tắt xong. Phần AI giữ mô hình trên GPU cần vài giây để nhả bộ nhớ, và trước đây bộ cài thấy nó vẫn còn chạy.

### Lưu ý
- Máy đang kẹt ở bản cũ: bấm Cancel trên hộp thoại, rồi chạy Moshi-Setup-0.7.5.exe. Dữ liệu và tài khoản được giữ nguyên.
- Bản Windows chưa được thử bằng tay.

---

### English
- **Fix:** updates stopped at "Moshi cannot be closed – please close it manually": the installer judged "Moshi is running" by the install folder and was wrong even with Moshi closed. It now looks for Moshi itself, closes it (gently, then for good) and waits long enough before asking.
- **Moshi closes completely before installing:** on Update (and on quitting with an update waiting) Moshi waits for its AI part to exit; with a model on the GPU it needs a few seconds, and the installer used to find it still running.
- Notes: if an update is stuck on an older version, press Cancel on the dialog and run Moshi-Setup-0.7.5.exe; your data and accounts stay. The Windows build is not hand-tested.
