# Moshi: đề xuất làm lại UI (2026-10-10)

Mockup đầy đủ: `2026-10-10-ui-redesign.html` (mở bằng trình duyệt; cần mạng để tải Google Fonts, ảnh crop lấy từ `current-*.png` cùng thư mục). Không file nào trong `src/` bị thay đổi. Mọi token là đề xuất tạm vì repo chưa có DESIGN.md.

## Hiện trạng: điều cần sửa

1. **Thứ bậc phẳng.** Ba panel kính cùng độ sáng, cùng viền; nhãn sidebar IN HOA (INBOXES, TAGS, ACCOUNTS) nặng ngang tên chat.
2. **Hàng danh sách khó quét.** Chưa đọc, ghim, đang gõ, tắt thông báo gần như cùng một dáng (tên đậm + pill tím). Không có dấu hiệu ở mép hàng.
3. **Tương phản.** Chữ trắng trên accent #4f7df3 chỉ đạt 3,78:1; pill đếm tím nhạt khoảng 3,5:1. Chữ 11–13px đậm cần 4,5:1.
4. **Thang chữ sát nhau.** 11/12/13,5/15/17/24/32 chỉ cách 1–1,5px nên phân cấp dựa vào độ đậm 800; chưa có nhịp 4/8.
5. **Icon thiếu nhất quán.** Header chat nét mảnh khác sidebar; badge nền tảng vuông bo, avatar tròn; "send later" dùng đồng hồ báo thức dễ lẫn với nhắc việc.
6. **Kính dùng quá tay.** List, chat, composer, bubble đều blur/glow; ranh giới panel mờ.
7. **Composer chưa đủ affordance.** Năm icon cùng trọng lượng, vùng bấm ~28px, nút gửi xám trông như đang tải; chưa có chỗ cho gợi ý AI, hẹn giờ, ghi âm.
8. **Empty state nhỏ, CTA ồn.** Mascot nhỏ giữa khoảng trống lớn; nút gradient + glow + kbd tranh chú ý.
9. **Narrow mode mất định hướng.** Không còn bộ lọc nền tảng, không thấy tài khoản; preview bị cắt, ghim + số chen giờ.
10. **Emoji picker che ngữ cảnh.** Phủ lên đoạn tin đang trả lời, tab 24px, thiếu recents/skin tone.

Nên giữ: mascot cam, tag pastel không viền, avatar blob có mặt, giọng vui của câu chào.

## Ba hướng

| Hướng | Ý chính | Chi phí | Rủi ro |
|---|---|---|---|
| **A. Quiet Glass** | Một accent #2f5fe0, kính chỉ ở title bar + composer, lưới 8pt, hàng 64px, trạng thái đọc được trong 1 giây. Cảm giác Apple Mail/Messages. | Thấp–vừa (1–2 tuần) | Thấp |
| **B. Editorial** | Rail nền tảng 64px, tên bằng serif (Newsreader), hàng 3 dòng, ngày là đường kẻ mảnh, composer nổi, Details gắn cố định. | Cao (3–4 tuần) | Cao: đổi điều hướng, thấy ít chat hơn (~6 so với ~9) |
| **C. Playful Pals+** | Giữ bản sắc kẹo nhưng kỷ luật: đen là màu cấu trúc, kẹo chỉ cho nhân vật/số đếm/tag, vùng bấm 44–48px, mascot có việc, motion có nghĩa. | Vừa (2 tuần, mở rộng `pals.css`) | Vừa–thấp |

Tương phản đã tính bằng công thức WCAG trên màu đề xuất (chữ ≥ 4,5:1, icon ≥ 3:1): A ink3 5,3 / accent+trắng 5,48; B ink3 5,9 / accent 6,7 / viền điều khiển 3,2; C ink3 5,7 / chữ đen trên kẹo lilac 10,7. Chi tiết trong bảng so sánh của file HTML.

## Đề xuất

**A làm nền, C làm lớp bản sắc; không chọn B làm mặc định.**

- A cho Moshi thứ đang thiếu: thứ bậc rõ, tương phản đạt chuẩn, trạng thái đọc nhanh, mà vẫn giữ bố cục 3 cột người dùng đã quen.
- Moshi đã có bốn style (`data-style`): style mặc định "Moshi" lấy cấu trúc và token của A; style "Pals" nâng lên Pals+ (C). Ai thích màu vẫn có, không ai phải trả giá bằng độ ồn.
- B giữ làm ý tưởng cho chế độ Compact/Reading tùy chọn về sau (rail nền tảng, hàng 3 dòng); thay điều hướng mặc định lúc này quá rủi ro.

## Lộ trình

- **Pha 0 (1–2 ngày, không đổi bố cục):** accent #2f5fe0, sửa pill đếm, bỏ glow bubble/composer, nhãn sidebar viết thường, thống nhất nét icon 1,75px.
- **Pha 1 (tuần 1):** token type 12·13·14·15·17·22, lưới 8pt, hàng 64 với chấm chưa đọc, typing, Draft, ghim, tắt tiếng; badge nền tảng thống nhất.
- **Pha 2 (tuần 2):** nút Call/Video sau feature flag, toggle Details, chip gợi ý AI, Send later, ghi âm; component banner cuộc gọi đến.
- **Pha 3 (tuần 3):** panel đặc, kính chỉ ở title bar + composer; narrow có chip nền tảng và tab bar.
- **Pha 4 (viết lại lớn, làm sau):** Pals+ (motion pack, empty state mascot, blob avatar mới), layout Compact kiểu B (cần đo hành vi trước), rail nền tảng tùy chọn.

## Chưa thể hiện hoặc là giả định

- Chuyển động chỉ vẽ trạng thái nghỉ, riêng dấu chấm đang gõ, caret, vòng ring/sóng âm cuộc gọi và mascot nhún có animation thật; phần còn lại (bubble nở, gửi bay lên, chớp mắt) chỉ mô tả bằng chữ.
- Nút Call/Video chỉ là chỗ dự trữ; chưa có luồng gọi, màn hình gọi đang diễn ra, hay trạng thái nút bị tắt.
- Sticker/GIF/emoji picker chưa vẽ (chỉ nút mở); danh sách tag/tài khoản và các nền tảng khác Gmail/Slack chỉ đại diện.
- Style Liquid và Mono không có hướng riêng; A/C đề xuất thay thế mặc định "Moshi" và "Pals".
