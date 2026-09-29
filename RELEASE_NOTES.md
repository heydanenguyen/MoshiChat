## Moshi 0.2.4

### Sửa lỗi
- **Sticker tự làm tách nền được rồi.** Bản 0.2.3 báo lỗi khi tách chủ thể khỏi ảnh vì thư viện AI trong app không còn nhận model cũ (RMBG-1.4). Moshi chuyển sang MODNet: nhỏ hơn 6 lần (7 MB), giấy phép Apache-2.0, đẹp nhất với ảnh người và thú cưng. Nếu đã bấm tải model tách nền ở bản trước, vào Cài đặt → AI, xoá rồi tải lại.
- **macOS Apple Silicon nhận đúng bản cập nhật.** Trước đây file mô tả cập nhật của bản Intel đè lên bản Apple Silicon, nên máy M1 trở lên có thể được đưa bản Intel (AI trên máy không chạy). Từ bản này danh sách cập nhật liệt kê đủ cả hai kiến trúc.

---

### English
- Custom stickers cut the background out again: the AI library no longer accepted the old model (RMBG-1.4), so Moshi now uses MODNet (7 MB, Apache-2.0, best with people and pets). If you downloaded the cut-out model on 0.2.3, remove it in Settings → AI and download again.
- macOS: the update metadata now lists both Intel and Apple Silicon builds, so Apple Silicon Macs are offered the right one.
