# Moshi: ý tưởng chuyển động (2026-10-13)

Demo chơi thử được: `2026-10-13-motion-ideas.html` (mở bằng trình duyệt; cần mạng để tải Google Fonts, không cần thư viện nào khác). Mỗi ý là một thẻ có nút Phát, chip chi phí/rủi ro/perf; thanh trên có công tắc sáng/tối (chính nó là ý 9), "Giảm chuyển động" (áp dụng cách hành xử của `prefers-reduced-motion` cho mọi thẻ), "Chạy tất cả" và thanh "Độ nảy" (Calm / Vừa / Pals+) để thấy cùng một lò xo ở ba tính cách. Chưa file nào trong `src/` bị đổi; đây là đề xuất, chưa áp dụng gì.

Nền hình ảnh là hướng A "Quiet Glass" của `2026-10-10-ui-redesign.md` (accent #2f5fe0 / #86a4ff, hàng 64px, composer kính 48px, avatar 40px). Số ngày là ước lượng cho một người đã quen codebase, đã gồm reduced-motion và kiểm thử, chưa đo trên máy thật.

## Nguyên tắc chung

- **Lò xo thật, không phải cubic-bezier giả.** Demo tính lò xo từ (thời gian ổn định, độ vượt) rồi đưa vào `linear()` của CSS, chạy bằng Web Animations API. Cùng cách này dùng được trong Moshi (`--ease-spring` hiện chỉ là một bezier). Ba ý dùng lò xo chính: 1, 10, 16; thêm 2, 3, 8, 11, 22, 25 ở mức nhẹ.
- **Chỉ transform và opacity** là mặc định; ngoại lệ được ghi rõ ở cột perf (ý 6, 10, 16, 23, 17).
- **Không hover scale/translate** trên chữ và icon điều khiển (quy tắc của repo): ý 19 là lúc nhấn, không phải rê.
- **Vòng lặp nền** (5, 12, 14, 16, 17) chỉ chạy khi thẻ đang thấy trên màn hình và cửa sổ không bị ẩn; trên trang demo, góc phải thẻ có chấm "đang chạy / tạm dừng" để kiểm chứng.
- **Mỗi ý có fallback `prefers-reduced-motion`**: tối đa là hiện dần (opacity), thường là bỏ hẳn. Không có nhấp nháy quá 3Hz.

## Nhóm 1. Cảm giác trong cuộc chat

| # | Ý tưởng | Ở đâu | Ngày | Rủi ro | Perf | Reduced motion |
|---|---|---|---|---|---|---|
| 1 | Gửi: bật lên rồi lắng | bubble gửi đi, composer | 1,5 | thấp | transform + opacity, 1 phần tử | hiện dần 120ms |
| 2 | Tin đến: trượt lên có khối lượng | bubble nhận | 1 | thấp | transform + opacity | hiện dần, không trượt |
| 3 | Thả cảm xúc: tung hạt | chọn reaction | 1,5 | thấp | 8 phần tử × 600ms rồi gỡ | pill hiện dần, không hạt |
| 4 | Đã xem: dấu tích vẽ ra | meta bubble, preview ở danh sách | 0,5 | thấp | SVG nhỏ, paint 200ms | đổi màu tức thì |
| 5 | Đang gõ: chấm thở theo sóng | bubble "đang gõ", hàng danh sách | 0,5 | thấp | lặp 1,6s, transform + opacity, dừng khi ẩn | chấm sáng lần lượt, không dịch |
| 6 | Composer: nút gửi từ tính | composer | 1 | thấp | pill đổi width 200ms (layout 1 phần tử nhỏ) | đổi chỗ tức thì |
| +22 | Vuốt để trả lời (dây cao su) | kéo bubble sang phải | 1,5 | vừa | transform theo pointer | không rubber-band, vẫn trả lời được |
| +23 | Tin thoại: sóng âm đổ đầy | bubble voice | 1 | thấp | clip-path trên 1 lớp (paint nhẹ) | sóng đổi màu theo bước 250ms |
| +24 | Xóa tin: tan rồi khép lại | xóa/thu hồi tin | 1 | vừa | blur 220ms trên 1 bubble | biến mất ngay, không khép |
| +25 | Số chưa đọc: cuộn chữ số | badge đếm, tab bar | 0,5 | thấp | transform + opacity; width pill 200ms | đổi số tức thì |

1. Bubble xuất phát ở 0,92 từ vị trí composer, vượt lên 1,02 rồi lắng trong 320ms; composer thở ra 0,985 → 1; tin cũ trượt theo (FLIP). Có ba biến thể: chữ, sticker, ảnh.
2. Bubble trượt 8px với một cú vượt nhẹ; ba tin đến cùng lúc thì trễ 40ms mỗi tin; avatar gật 2° đúng một lần.
3. Tám hạt (4 emoji + 2 màu × 2) vẽ cung rồi mờ trong 600ms; pill reaction nở ra từ đúng điểm chạm.
4. Dấu tích xám vẽ thêm nét thứ hai bằng `stroke-dashoffset` 200ms, cả hai chuyển accent.
5. Ba chấm nhấc lên lần lượt, cả pill thở 1 → 1,03; khi dừng thì chạy nốt chu kỳ rồi về trạng thái tĩnh (không giật).
6. Có chữ: mic xoay ra, nút gửi xoay vào từ −90°, pill "Gửi sau" mở từ 36px ra đủ chữ. Ô nhập trên demo là thật.
+22. Kéo càng nặng; tới ngưỡng thì icon trả lời búng một nhịp và thanh trích dẫn hiện ở composer; thả ra thì bật về bằng lò xo. Bàn phím: focus bubble, nhấn R.
+23. Nút phát đổi sang tạm dừng bằng xoay + co giãn; sóng âm đổ dần theo thời lượng; đổi tốc độ không giật (`playbackRate`).
+24. Cùng cơ chế với `usePresence`: tan 220ms rồi các tin dưới khép lên bằng lò xo thay vì nhảy.
+25. Mỗi chữ số cuộn 20px kèm mờ; 9 → 10 thì pill nở ra bằng lò xo; không chớp cả badge.

## Nhóm 2. Chuyển giữa các nơi

| # | Ý tưởng | Ở đâu | Ngày | Rủi ro | Perf | Reduced motion |
|---|---|---|---|---|---|---|
| 7 | Mở chat: avatar bay lên header | bấm hàng, chuyển chat (đã có `viewTransition.ts`) | 2 | vừa | ảnh chụp compositor; tên phải duy nhất (danh sách ảo hóa) | đổi tức thì, thân chat hiện dần 140ms |
| 8 | Details: lớp nền lùi lại | mở/đóng panel Details | 1,5 | vừa | blur chỉ trong 240ms rồi gỡ | pane hiện dần, cột không dịch |
| 9 | Đổi sáng/tối: vòng tròn mở ra | công tắc giao diện | 1 | vừa | chụp cả cửa sổ; fallback crossfade trên máy yếu | crossfade 160ms |
| 10 | Tab bar hẹp: viên thuốc chảy | tab bar narrow | 1,5 | vừa | clip-path + `@property` trên 1 lớp, không layout | nhảy thẳng, đổi màu 160ms |
| 11 | Danh sách: chat mới trồi lên đầu | sắp xếp lại hàng (mở rộng `flip.ts`) | 1,5 | vừa | FLIP bằng transform; bóng là lớp opacity | sắp xếp ngay, hàng sáng dần |

7. Hàng được bấm đặt `view-transition-name` cho avatar và tên, header đặt cùng tên; trình duyệt nội suy vị trí và kích thước (420ms). Danh sách mờ 160ms, thân chat hiện sau.
8. Pane trượt vào bằng lò xo 280ms; cột chat lùi 24px, mờ 3px rồi nét dần và tối đi chút để có chiều sâu; đóng thì đảo ngược.
9. Ảnh chụp hai bản giao diện, bản mới cắt bằng `clip-path: circle()` mở rộng từ điểm bấm trong 480ms.
10. Viên chỉ báo có hai cạnh độc lập: cạnh dẫn lao tới tab đích bằng lò xo cứng, cạnh đuôi theo sau (mềm, trễ 40ms) nên nó giãn ra rồi chốt lại. Dùng clip-path nên góc không méo.
11. Hàng có tin mới nhấc 2px kèm bóng, trượt lên đầu trong khi các hàng khác tách ra (trễ 25ms theo khoảng cách), rồi đặt xuống; chấm chưa đọc bật ra sau cùng.

## Nhóm 3. Không khí

| # | Ý tưởng | Ở đâu | Ngày | Rủi ro | Perf | Reduced motion |
|---|---|---|---|---|---|---|
| 12 | Màu nền sống: hai vệt sáng trôi | nền sau sidebar và list | 1 | thấp | 2 lớp GPU (`will-change`), dừng khi ẩn/ngoài màn | đứng yên |
| 13 | Ánh kính: vệt sáng một lần | title bar, composer | 0,5 | thấp | một transform 700ms rồi gỡ | bỏ |
| 14 | Mascot: bộ năm hành vi | logo, trạng thái trống, chuông cuộc gọi | 3 | vừa | chủ yếu sự kiện một lần; hai vòng lặp nhỏ chỉ khi thấy | không theo dõi, không nhún; ngủ = mắt nhắm |
| 15 | Skeleton: vệt sáng chéo | hàng đang tải, ảnh/tệp chưa có | 1 | thấp | 1 lớp nhỏ mỗi khối; ≤ 12 khối; dừng khi xong | khối nhấp nháy mờ chậm |

12. Hai vệt radial (xanh và tím như nền hướng A) trôi 60s theo transform. Nút "Tua nhanh" chỉ đổi `playbackRate` để thấy hướng trôi; thực tế gần như không nhận ra bằng mắt, đó là chủ ý.
13. Đường sáng 1px lướt qua viền kính 700ms kèm vệt mờ trên mặt kính, khi cửa sổ lấy focus hoặc sau khi gửi.
14. Chớp (có sẵn), liếc, mắt theo con trỏ (±4px), nhún có co giãn khi có tin ở chat đang mở, buồn ngủ ở trạng thái trống sau 30s (demo bấm nút), ló đầu từ mép title bar khi có cuộc gọi.
15. Chỉ dùng khi biết hình dạng nội dung; vệt sáng chéo 1,4s; xong thì lớp nội dung hiện dần 280ms.

## Nhóm 4. Xu hướng 2026

| # | Ý tưởng | Ở đâu | Ngày | Rủi ro | Perf | Reduced motion |
|---|---|---|---|---|---|---|
| 16 | Viên Dynamic Island cho cuộc gọi | thanh cuộc gọi dưới title bar | 3 | cao | width/height/bo góc trên 1 phần tử cô lập (`contain`); chữ chỉ opacity + blur | đổi cỡ tức thì, nội dung hiện dần 140ms, sóng đứng yên |
| 17 | Chữ AI: vệt sáng chậm | chip gợi ý, nhãn "Tóm tắt AI" | 0,5 | thấp | paint chữ mỗi khung hình: ≤ 4 chỗ, dừng khi ẩn | màu tĩnh |
| 18 | Cuộn có chiều sâu | ngăn cách ngày, mép trên thread | 2 | vừa | timeline CSS, không JS; cần Chromium ≥ 115 | bubble đứng yên, ngày chỉ mờ |
| 19 | Nhấn: nút lún xuống | mọi nút (CSS dùng chung) | 1 | thấp | transform trên phần tử bị bấm | chỉ giảm độ đậm 70% |
| 20 | Khởi động: ba lớp lần lượt hiện | lúc mở app | 1 | thấp | transform + opacity, một lần | một lần mờ vào 160ms |
| 21 | Gói ăn mừng: confetti có vật lý | sinh nhật, hiệu ứng tin nhắn, sticker | 2,5 | vừa | 1 canvas, rAF chỉ chạy khi còn hạt (≈ 2,5s) | bó mảnh tĩnh mờ vào rồi ra |

16. Viên đen bo squircle (`corner-shape` nếu trình duyệt có) đổi hình bằng lò xo 380ms: chấm → đang đổ chuông (avatar + vòng sóng) → đang gọi (đồng hồ + sóng âm) → mở rộng khi rê/focus (tắt mic, loa, kết thúc) → "Đã kết thúc". Nội dung hai trạng thái mờ qua nhau (blur-through), chữ không trượt. Rê chuột vào viên khi đang gọi để thấy trạng thái mở rộng. Chưa nối vào luồng gọi thật.
17. Gradient chạy qua chữ bằng `background-clip: text`, 2,4s một lượt rồi nghỉ (không chạy liên tục để mắt không bị kéo).
18. Ngăn cách ngày dính ở đầu, nền kính nhòe, mờ đi khi ngày kế tiếp tới; bubble gần mép trên mờ và co nhẹ thay vì bị cắt phẳng (nâng cấp `edge-fade`).
19. Nhấn xuống 0,96 trong 90ms (ease-out), nhả ra bật lại bằng lò xo; nút icon nghiêng 2° về phía điểm bấm.
20. Sidebar 30ms/mục, hàng danh sách 24ms/hàng, cột chat mờ vào cuối cùng; tổng ≈ 540ms.
21. 60 mảnh confetti có trọng lực, lực cản và xoay lật, 2,5s; tim bay trôi và xoay; sticker rơi xuống rồi một vệt sáng và vài tia lấp lánh quét qua.

## Gói đề xuất

| Gói | Gồm | Tổng ngày | Style áp dụng |
|---|---|---|---|
| **1 · Calm** (tinh tế, kiểu Apple) | 1, 2, 4, 5, 6, 8, 13, 15, 20 | **8,5** | Moshi: đầy đủ. Liquid: đầy đủ, ánh kính (13) hợp nhất. Mono: bỏ 13, lò xo đổi sang ease-out không nảy. Pals: áp dụng nhưng nên dùng gói 3. |
| **2 · Expressive** (đề xuất chọn) | Gói 1 + 3, 7, 9, 10, 11, 16, 18, 19 | **22** | Moshi: đầy đủ. Liquid: đầy đủ, hợp với 9 và 16. Mono: bỏ 9, 16 đổi sang viên phẳng không squircle, lò xo ít nảy. Pals: áp dụng; 3 và 19 hợp với Pals. |
| **3 · Pals+ vui nhộn** | Gói 2 + 14, 21, và lò xo nảy hơn | **28,5** (gồm 1 ngày chỉnh bộ lò xo) | Pals: đích chính, đầy đủ. Moshi: chỉ lấy phần gói 2, mascot ở dạng tĩnh. Liquid: gói 2 là đủ, 21 tùy chọn. Mono: không áp dụng 14, 21. |

Ý 12 và 17 không nằm trong gói nào (đẹp nhưng có chi phí nền; làm riêng nếu thích). Bốn ý + (22 vuốt trả lời 1,5; 23 tin thoại 1; 24 xóa tin 1; 25 số chưa đọc 0,5; cộng 4 ngày) là tùy chọn, thêm vào gói nào cũng được.

## Đề xuất

**Gói 2, làm theo hai đợt.** Đợt 1 là Gói 1 (8,5 ngày, rủi ro thấp, không đụng cấu trúc, đã thấy khác biệt ngay). Đợt 2 là phần Expressive còn lại, trong đó **16 làm cuối và đi cùng feature flag nút Call** (rủi ro cao vì phụ thuộc luồng gọi chưa có). Gói 3 chỉ nên bật khi style Pals được chọn, vì độ nảy lớn sẽ ồn trong style Moshi/Mono.

## Chưa thể hiện hoặc là giả định

- Mascot ở thẻ 14 và các sticker là bản vẽ lại gần giống bộ đôi cam/hồng, không dùng đúng markup của `src/shared/logos.ts`; mắt, miệng và đường cong có thể khác bản thật.
- Thẻ 7 và 9 dùng View Transitions, thẻ 18 dùng scroll-driven animations (Chromium ≥ 115). Cần kiểm tra bản Chromium của Electron trước khi cam kết; `viewTransition.ts` có sẵn nên 7 và 9 khả thi, nhưng chưa thử trong Moshi.
- Thẻ 16 chưa nối vào luồng gọi thật; chỉ chứng minh chất lượng morph. Chưa thử cuộc gọi video và nhóm. Bo squircle chỉ hiện ở trình duyệt có `corner-shape`, nơi khác là bo tròn thường.
- Cột "perf" mô tả cơ chế (compositor hay paint), không phải số đo FPS/CPU trong Moshi. Chưa đo.
- Demo dùng hướng A; bốn style (Moshi/Liquid/Mono/Pals) không có demo riêng. Cột "style áp dụng" của các gói là đánh giá theo đặc tính từng style, chưa thử.
- Thẻ 12 chạy 60s/vòng nên gần như không thấy chuyển động; "Tua nhanh" chỉ để minh họa hướng trôi. Thẻ 14 "buồn ngủ" lẽ ra tự bật sau 30s ở trạng thái trống; ở demo bấm nút.
- Chưa có âm thanh hay haptic thật đi kèm (thẻ 19 và 21 chỉ có phần hình).
- Số ngày giả định một người làm, đã quen `app.css`, `flip.ts`, `usePresence.ts`; chưa gồm review thiết kế sau khi thấy bản chạy thật.
