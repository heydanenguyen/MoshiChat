## Moshi 0.4.1

Bản sửa lỗi và làm nhẹ tính năng **tách nền sticker**. Từ 0.4.0, Moshi tự tải bản này ở nền và chỉ hỏi bạn khởi động lại.

### Tách nền sticker
- **Sửa lỗi "The AI worker stopped":** tách nền bằng mô hình AI (BiRefNet) bị sập giữa chừng vì Moshi giới hạn những khối bộ nhớ quá lớn; giờ chạy hết, mỗi ảnh vài giây.
- **Trên Mac (macOS 14 trở lên) nhanh và nhẹ hơn hẳn:** Moshi dùng tính năng tách chủ thể có sẵn của macOS (như "nhấc chủ thể" trong ứng dụng Ảnh): khoảng 0,3 giây và vài chục MB thay vì vài giây và khoảng 6 GB bộ nhớ, không cần tải mô hình 115 MB.
- **Nút "Cắt kỹ hơn":** khi muốn đường cắt tinh hơn, bấm để cắt lại bằng mô hình AI của Moshi (lần đầu cần tải mô hình).
- **Máy thiếu bộ nhớ được báo rõ:** trên Windows và Mac đời cũ, nếu máy không đủ khoảng 6 GB bộ nhớ trống, Moshi báo lý do thay vì báo lỗi khó hiểu.
- Các nút sau khi tách nền không còn bị gãy chữ.

### Lưu ý
- Tách nền bằng tính năng của macOS giữ cả những thứ nó coi là chủ thể (ví dụ cái bàn trong ảnh); dùng "Cắt kỹ hơn" khi cần cắt sát hơn.
- Bản Windows chưa được thử bằng tay.

---

### English
From 0.4.0, Moshi downloads this update in the background and only asks you to restart.

- **Fixed "The AI worker stopped"** when cutting out a sticker's background: the AI model (BiRefNet) crashed because Moshi's memory allocator refuses very large blocks; it now runs through, a few seconds a picture.
- **Much faster and lighter on Macs with macOS 14 or later:** Moshi uses macOS's own subject lifting (like "lift subject" in Photos), about 0.3 s and a few dozen MB instead of seconds and ~6 GB, with no 115 MB model to download.
- **"Cut more precisely"** re-cuts the sticker with Moshi's AI model when you want a finer edge (downloads the model the first time).
- **Not enough memory is said plainly** on Windows and older Macs (the AI model needs about 6 GB free) instead of an obscure error.
- The buttons after a cut-out no longer break their labels.
- Notes: macOS keeps everything it considers part of the subject (a desk, for example); use "Cut more precisely" for a tighter cut. The Windows build is not hand-tested.
