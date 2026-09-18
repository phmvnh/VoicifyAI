# AI Summary

## Luồng hoạt động

1. Mở thẻ **AI Summary** ở cột bên phải hoặc **Cài đặt → Model & Engine**.
2. Chọn nhà cung cấp và model, nhập API key rồi nhấn **Kết nối**.
3. Ứng dụng gọi endpoint thông tin model với thời gian chờ tối đa 10 giây để xác minh API key và quyền truy cập model. Cấu hình chỉ được lưu nếu kết nối thành công.
4. Provider/model được lưu tại `summary-settings.json` trong thư mục dữ liệu bền vững
   của ứng dụng (`app.path().app_data_dir()`). API key được lưu riêng bằng keyring của
   hệ điều hành; frontend không thể đọc lại giá trị đã lưu.
5. Sau khi có transcript, mở tab **Tóm tắt**, chọn kiểu trình bày và nhấn **Tạo bản tóm tắt**.
6. Rust/Tauri đọc key từ keyring, gọi API nhà cung cấp và chỉ trả nội dung tóm tắt về frontend.

FastAPI local chỉ xử lý nhận diện giọng nói và không nhận, lưu hoặc log API key AI.

## Nhà cung cấp

- Gemini: Gemini `generateContent` API.
- Grok: xAI Chat Completions API.
- OpenAI: Responses API.
- Anthropic: Messages API.

Các model được giới hạn bằng allowlist ở cả frontend và Rust. Khi bổ sung model, cần cập nhật đồng thời `src/lib/aiSummary.ts` và `src-tauri/src/ai_summary.rs`.

## Bảo mật

- Không đưa API key vào `.env` hoặc source code.
- Không trả API key từ Tauri về frontend sau khi lưu.
- Không ghi API key vào log.
- Mỗi nhà cung cấp có một keyring entry riêng. Khi mở lại ứng dụng hoặc quay lại nhà cung cấp đã kết nối, người dùng không phải nhập lại API key.
- Đăng nhập, đăng xuất hoặc đổi tài khoản Google không đọc, ghi hay xóa cấu hình AI Summary.
- Các thao tác đọc, lưu, xóa và lấy credential để gọi summary được serialize trong
  `SummarySettingsStore` để tránh race condition.
- Nếu Credential Manager không thể giải mã key, giao diện hiển thị lỗi và vẫn cho phép
  xóa cấu hình hoặc nhập key mới; ứng dụng không tự động xóa dữ liệu.
- Nút xóa cấu hình xóa key của nhà cung cấp đang chọn khỏi keyring.
