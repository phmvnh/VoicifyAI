# VoicifyAI

VoicifyAI là ứng dụng desktop hỗ trợ ghi âm, chuyển giọng nói thành văn bản và tóm tắt nội dung cuộc họp bằng AI. Ứng dụng chạy cục bộ với React, Tauri, FastAPI và `faster-whisper`.

## Tính năng

- Chuyển âm thanh thành văn bản bằng Whisper trên CPU hoặc NVIDIA GPU.
- Thu trực tiếp từ microphone và âm thanh hệ thống.
- Mở tệp âm thanh để phiên âm theo lô.
- Tải, chọn và gỡ các model Whisper ngay trong ứng dụng.
- Tạo bản tóm tắt bằng Gemini, Grok, OpenAI hoặc Anthropic.
- Lưu lịch sử transcript trên thiết bị.
- Đăng nhập Google và lưu kết quả vào Drive, Sheets và Calendar.
- Giao diện sáng, tối hoặc theo cài đặt hệ thống.

> [!NOTE]
> Phiên bản hiện tại được phát triển và kiểm thử chủ yếu trên Windows. Tính năng thu âm thanh hệ thống sử dụng WASAPI nên chỉ hoạt động trên Windows.

## Kiến trúc

| Thành phần | Công nghệ | Vai trò |
| --- | --- | --- |
| Giao diện | React, TypeScript, Vite | Hiển thị và điều khiển ứng dụng |
| Desktop | Tauri 2, Rust | Thu âm, lưu dữ liệu và tích hợp hệ điều hành |
| API cục bộ | FastAPI | Cung cấp REST API và WebSocket cho phiên âm |
| Nhận diện giọng nói | faster-whisper, CTranslate2 | Chạy model Whisper trên CPU/GPU |

Khi chạy ở chế độ phát triển, ứng dụng sử dụng hai địa chỉ cục bộ:

- Vite: `http://127.0.0.1:1420`
- FastAPI: `http://127.0.0.1:8765`

## Yêu cầu hệ thống

Trước khi cài đặt, hãy chuẩn bị:

- Windows 10 hoặc Windows 11.
- [Python](https://www.python.org/downloads/) 3.9 trở lên.
- [Node.js](https://nodejs.org/) 20 trở lên và npm.
- [Rust](https://www.rust-lang.org/tools/install) stable cùng Cargo.
- Microsoft C++ Build Tools với workload **Desktop development with C++**.
- Microsoft Edge WebView2 Runtime. Thành phần này thường đã có trên Windows 10/11.
- Kết nối Internet trong lần đầu tải dependency và model Whisper.

GPU không bắt buộc. Ứng dụng có thể chạy bằng CPU với `compute type` là `int8`. Nếu dùng NVIDIA GPU, môi trường cần tương thích với CUDA 12 và cuDNN 9; ứng dụng cũng có chức năng quản lý runtime GPU cục bộ.

## Cài đặt

### 1. Tải mã nguồn

```powershell
git clone https://github.com/phmvnh/VoicifyAI.git
cd VoicifyAI
```

### 2. Tạo môi trường Python

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt -r api/requirements.txt
```

Nếu PowerShell chặn script kích hoạt môi trường ảo, chạy lệnh sau trong phiên terminal hiện tại rồi thử lại:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### 3. Cài dependency frontend và Tauri

```powershell
npm install
```

### 4. Tạo cấu hình cục bộ

```powershell
Copy-Item .env.example .env
```

Google OAuth là tùy chọn. Nếu chưa cần đăng nhập Google, có thể giữ nguyên các giá trị mẫu trong `.env`. Không commit file `.env` hoặc credential thật lên GitHub.

## Chạy ứng dụng

Kích hoạt môi trường Python nếu terminal hiện tại chưa kích hoạt:

```powershell
.\venv\Scripts\Activate.ps1
```

Sau đó chạy:

```powershell
npm run tauri dev
```

Lệnh này mở ứng dụng Tauri và tự khởi động Vite cùng FastAPI. Không cần chạy ba tiến trình riêng.

Trong lần sử dụng đầu tiên:

1. Mở danh sách model trong ứng dụng.
2. Tải một model, chẳng hạn `tiny`, `base` hoặc `turbo`.
3. Chọn CPU và `int8` nếu máy không có NVIDIA GPU.
4. Chọn microphone hoặc âm thanh hệ thống rồi bắt đầu ghi; cũng có thể mở một tệp âm thanh.

Model được tải từ Hugging Face và lưu trong cache trên máy. Thời gian tải phụ thuộc vào kích thước model và tốc độ mạng.

## Chạy riêng từng thành phần

Chạy toàn bộ bản web bằng một lệnh:

```powershell
npm run dev:web
```

Sau đó mở `http://127.0.0.1:1420`. Lệnh này khởi động cả FastAPI và Vite, nhưng
không mở cửa sổ Tauri.

Nếu cần chạy riêng từng tiến trình, chạy FastAPI:

```powershell
python -m uvicorn api.main:app --host 127.0.0.1 --port 8765
```

Swagger UI sẽ có tại `http://127.0.0.1:8765/docs`. Xem thêm ví dụ gọi API trong [api/README.md](api/README.md).

Sau đó chạy riêng giao diện web ở terminal khác:

```powershell
npm run dev
```

Mở `http://127.0.0.1:1420`. Bản web hiện hỗ trợ:

- Mở file và phiên âm qua FastAPI.
- Thu microphone trực tiếp bằng Web Audio API.
- Thu âm thanh tab/màn hình khi trình duyệt hỗ trợ và người dùng bật chia sẻ audio.
- Lưu lịch sử transcript trong local storage của trình duyệt.
- Tạo AI Summary qua FastAPI; API key chỉ được giữ trong session của tab.

Google Archive hiện vẫn chỉ có trên bản Tauri. Trước khi chạy web, FastAPI phải đang
chạy tại `http://127.0.0.1:8765` như hướng dẫn phía trên. Dùng `npm run tauri dev` khi
cần bản desktop với WASAPI, Credential Manager và Google OAuth dạng Desktop app.

## Google OAuth

Để bật đăng nhập Google:

1. Tạo OAuth Client trong Google Cloud với loại ứng dụng **Desktop app**.
2. Bật các API Google Drive, Google Sheets và Google Calendar.
3. Khai báo các biến sau trong `.env`:

```env
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-desktop-client-secret
```

Nếu OAuth consent screen đang ở chế độ Testing, hãy thêm tài khoản cần đăng nhập vào danh sách test users. Hướng dẫn chi tiết và danh sách scope nằm tại [docs/GOOGLE_OAUTH.md](docs/GOOGLE_OAUTH.md).

## Tóm tắt bằng AI

API key dùng để tóm tắt không được đặt trong `.env`. Trong ứng dụng, mở phần cấu hình AI Summary, chọn nhà cung cấp và nhập API key. Key được lưu trong keyring của hệ điều hành và chỉ được dùng khi tạo bản tóm tắt.

Các nhà cung cấp hiện được hỗ trợ:

- Google Gemini
- xAI Grok
- OpenAI
- Anthropic

## Kiểm tra dự án

Kiểm tra TypeScript và Rust:

```powershell
npm run check
```

Kiểm tra bản build frontend:

```powershell
npm run build
```

Để chạy test Python và Rust, cài thêm dependency phát triển rồi chạy:

```powershell
python -m pip install -e ".[dev]" -r api/requirements.txt
npm test
```

## Đóng gói ứng dụng

```powershell
npm run tauri build
```

Artifact Tauri được tạo trong `src-tauri/target/release/bundle`.

> [!WARNING]
> Quy trình build hiện tại chưa đóng gói Python, FastAPI và model Whisper vào installer. Bản build Tauri vẫn cần API cục bộ chạy tại `127.0.0.1:8765`. Hãy xử lý việc sidecar/đóng gói backend trước khi phát hành installer cho người dùng cuối.

## Biến môi trường frontend

Các giá trị sau là tùy chọn; mặc định phù hợp khi chạy toàn bộ dự án trên cùng máy:

```env
VITE_API_BASE_URL=http://127.0.0.1:8765
VITE_STREAM_URL=ws://127.0.0.1:8765/v1/transcribe/stream
```

## Xử lý lỗi thường gặp

### Không tìm thấy `cargo`

Cài Rust bằng `rustup`, mở terminal mới rồi kiểm tra:

```powershell
rustc --version
cargo --version
```

### FastAPI không khởi động

Đảm bảo môi trường ảo đang được kích hoạt và kiểm tra dependency:

```powershell
python -m pip install -r requirements.txt -r api/requirements.txt
python -m uvicorn api.main:app --host 127.0.0.1 --port 8765
```

### Không thể dùng GPU

Chuyển thiết bị sang CPU và chọn `int8` để xác nhận ứng dụng hoạt động trước. Sau đó kiểm tra driver NVIDIA, CUDA/cuDNN hoặc cài runtime GPU từ giao diện ứng dụng.

### Không có âm thanh hệ thống

WASAPI loopback chỉ nhận dữ liệu khi Windows đang phát âm thanh. Hãy phát thử một video hoặc tệp âm thanh và kiểm tra đúng thiết bị output mặc định.

## Bảo mật

- `.env`, API key và OAuth token không được commit lên Git.
- OAuth token và API key AI được lưu bằng keyring của hệ điều hành.
- Không ghi credential hoặc transcript nhạy cảm vào log khi báo lỗi.
- Ứng dụng gửi transcript tới nhà cung cấp AI chỉ khi người dùng yêu cầu tạo tóm tắt.

## Nguồn mở

Phần nhận diện giọng nói của dự án dựa trên [faster-whisper](https://github.com/SYSTRAN/faster-whisper) và [CTranslate2](https://github.com/OpenNMT/CTranslate2). Xem [LICENSE](LICENSE) để biết thông tin giấy phép.
