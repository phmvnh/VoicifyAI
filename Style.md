# Style Guide — iOS / macOS Design System

> Tài liệu này định nghĩa quy tắc thiết kế theo phong cách Apple (Human Interface Guidelines) để AI coding assistant tuân theo khi sinh code UI (SwiftUI / UIKit / AppKit hoặc web mô phỏng phong cách iOS/macOS). Đọc toàn bộ file trước khi viết bất kỳ component nào.

---

## 1. Nguyên tắc cốt lõi

- **Clarity** — Nội dung là trọng tâm, giao diện không được lấn át nội dung. Ưu tiên khoảng trắng, độ tương phản đủ, icon rõ nghĩa.
- **Deference** — Chrome (thanh điều hướng, nền, viền) phải mờ nhạt để nhường chỗ cho nội dung. Tránh viền/đổ bóng thừa.
- **Depth** — Dùng lớp (layer), blur, chuyển động để truyền đạt phân cấp (hierarchy) và trạng thái, không dùng để trang trí.
- Không sao chép y hệt Material Design (Android): tránh FAB tròn nổi, ripple effect, elevation shadow nặng, bottom sheet kiểu Material.

---

## 2. Typography

- Font hệ thống: **SF Pro** (iOS/macOS), **SF Pro Rounded** cho các ngữ cảnh thân thiện/game, **SF Mono** cho code. Trên web dùng `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", sans-serif`.
- Dùng **Dynamic Type scale** (điểm size chuẩn của Apple), không tự chế số lẻ:

| Style | Size (pt) | Weight |
|---|---|---|
| Large Title | 34 | Bold |
| Title 1 | 28 | Bold/Regular |
| Title 2 | 22 | Bold/Regular |
| Title 3 | 20 | Semibold |
| Headline | 17 | Semibold |
| Body | 17 | Regular |
| Callout | 16 | Regular |
| Subheadline | 15 | Regular |
| Footnote | 13 | Regular |
| Caption 1 | 12 | Regular |
| Caption 2 | 11 | Regular |

- Line-height ≈ 1.2–1.3× font size. Letter-spacing gần như mặc định (0), không kéo giãn chữ hoa.
- **Không dùng ALL CAPS** cho nhãn (label) trừ khi Apple tự dùng (ví dụ tab bar text hiếm khi caps).
- Trọng lượng chữ (weight) là công cụ phân cấp chính, hơn là đổi màu hay đổi font.

---

## 3. Màu sắc

- Dùng **semantic colors**, không hard-code hex khi có thể — để tự thích ứng Light/Dark Mode:
  - `label`, `secondaryLabel`, `tertiaryLabel`, `quaternaryLabel`
  - `systemBackground`, `secondarySystemBackground`, `tertiarySystemBackground`
  - `systemFill`, `secondarySystemFill`, `tertiarySystemFill`, `quaternarySystemFill`
  - `separator`, `opaqueSeparator`
- Accent color mặc định: **iOS Blue `#007AFF`** (light) / `#0A84FF` (dark). Có thể đổi theo brand nhưng chỉ 1 accent color chủ đạo cho toàn app.
- Bảng màu hệ thống tham khảo (light mode):
  - Blue `#007AFF`, Green `#34C759`, Indigo `#5856D6`, Orange `#FF9500`, Pink `#FF2D55`, Purple `#AF52DE`, Red `#FF3B30`, Teal `#5AC8FA`, Yellow `#FFCC00`
- **Luôn hỗ trợ Dark Mode** — không bao giờ hard-code nền trắng/đen tuyệt đối. Nền light mode không phải `#FFFFFF` thuần mà thường `#F2F2F7` (grouped) hoặc trắng cho plain.
- Contrast tối thiểu theo WCAG AA cho text.

---

## 4. Layout & Spacing

- Đơn vị cơ sở: **8pt grid** (bội số của 4/8). Margin ngoài màn hình tiêu chuẩn: **16pt** hoặc **20pt**.
- Safe Area: luôn tôn trọng notch/Dynamic Island, home indicator, status bar.
- Khoảng cách giữa các nhóm nội dung (section) lớn hơn khoảng cách trong nhóm (ví dụ 24–32pt giữa section, 8–12pt giữa item cùng nhóm).
- Danh sách dùng **grouped/inset grouped list style**: nền section khác nền chính, bo góc, có padding trong.
- Căn lề trái theo mặc định (leading-aligned), tránh center-align hàng loạt trừ khi là tiêu đề/empty state.

---

## 5. Hình khối & Bo góc

- Corner radius theo **continuous/squircle curve** (superellipse), không phải bo tròn CSS thường:
  - Button nhỏ: 8–10pt
  - Card / Sheet: 12–16pt
  - App icon: dùng squircle chuẩn của Apple, không tự vẽ bo tròn thường.
- **Không** dùng một border-radius đồng nhất cho mọi thứ bất kể kích thước — radius tỉ lệ theo kích thước phần tử (phần tử càng lớn, radius càng lớn).
- Border/outline mảnh (hairline, 1px chia theo `separator` color), hạn chế shadow nặng. Shadow (nếu có) rất nhẹ, lan tỏa, không cứng.

---

## 6. Vật liệu (Materials) & Hiệu ứng

- Dùng **blur/vibrancy** cho thanh điều hướng, tab bar, sheet nổi trên nội dung (giống `UIBlurEffect` / `.ultraThinMaterial`, `.thinMaterial`, `.regularMaterial`, `.thickMaterial`).
- Tránh gradient trang trí tùy tiện — gradient chỉ dùng khi có ý nghĩa (ví dụ làm mờ dần nội dung phía sau thanh điều hướng).
- Depth thể hiện qua lớp che phủ (overlay/sheet) trượt lên trên, không qua đổ bóng giả 3D nặng.

---

## 7. Component chuẩn

- **Navigation Bar**: tiêu đề lớn (Large Title) khi ở top-level, thu nhỏ khi cuộn (collapsing large title). Nút back dùng chevron + label, không icon lạ.
- **Tab Bar**: 3–5 tab, icon (SF Symbols) + label ngắn, tab đang chọn tô đậm bằng accent color.
- **Button**:
  - Primary: nền accent color, chữ trắng, bo góc 10pt, full-width hoặc capsule.
  - Secondary: outline hoặc tinted background (accent color độ mờ thấp).
  - Destructive: màu đỏ hệ thống.
- **List/Table**: hàng có chevron (`>`) nếu điều hướng tiếp, swipe-to-delete, section header viết thường không caps.
- **Sheet/Modal**: trượt từ dưới lên, có grabber handle (thanh nhỏ ở top), bo góc lớn ở 2 góc trên.
- **Alert/Action Sheet**: theo đúng mẫu hệ thống (title bold, message thường, action buttons tách dòng).
- **Toggle/Switch**: hình con nhộng bo tròn hoàn toàn, không dùng checkbox vuông.
- **Segmented Control**: nền `systemFill`, phần chọn có nền trắng/tối nổi lên với shadow nhẹ.

---

## 8. Icon

- Ưu tiên **SF Symbols** (hoặc icon set outline/filled tương đương phong cách line-based, stroke đều, góc bo).
- Icon và text cùng baseline, kích thước icon tỉ lệ với text style đi kèm (dùng size variant: `.caption`, `.body`, `.title` tương ứng).
- Không trộn nhiều style icon (filled + outline + 3D) trong cùng 1 màn hình.

---

## 9. Chuyển động (Motion)

- Easing chuẩn: `ease-in-out` mượt, spring animation nhẹ cho tương tác (kéo, mở sheet, chuyển trang).
- Duration ngắn: 200–350ms cho transition thông thường, spring cho gesture-driven interaction.
- Animation phải phản hồi hành động người dùng (mở, đóng, xác nhận) — tránh animation tự động chạy liên tục không lý do.
- Chuyển trang: push/pop trượt ngang (iOS), không dùng fade toàn màn hình như web SPA mặc định.

---

## 10. Accessibility & Responsive

- Hỗ trợ Dynamic Type (text scale theo cài đặt hệ thống), không fix chiều cao container theo 1 cỡ chữ.
- Contrast đủ AA, target chạm tối thiểu 44×44pt.
- Tôn trọng `prefers-reduced-motion` khi build web.
- VoiceOver labels rõ ràng cho mọi control tương tác.

---

## 11. Những điều KHÔNG làm

- Không dùng shadow Material Design nặng (`rgba(0,0,0,.2)` lan rộng) hoặc elevation z-index kiểu Android.
- Không dùng ripple effect khi chạm.
- Không dùng FAB (nút tròn nổi góc dưới) trừ khi đó là pattern rõ ràng của app đó.
- Không caps toàn bộ label/button.
- Không hard-code màu sáng/tối tuyệt đối, luôn dùng semantic color hoặc biến theo color scheme.
- Không dùng border-radius ngẫu nhiên khác nhau giữa các component cùng cấp.
- Không nhồi nhét nhiều accent color trong 1 màn hình.

---

## 12. Checklist trước khi hoàn thành 1 màn hình/component

- [ ] Dùng đúng type scale và weight theo bảng ở mục 2
- [ ] Có hỗ trợ Dark Mode qua semantic color
- [ ] Spacing theo bội số 8pt
- [ ] Corner radius tỉ lệ theo kích thước phần tử
- [ ] Navigation/tab bar dùng blur material
- [ ] Icon dùng SF Symbols hoặc tương đương, đồng bộ style
- [ ] Animation có mục đích, không dư thừa
- [ ] Target chạm ≥ 44×44pt, contrast đạt AA
