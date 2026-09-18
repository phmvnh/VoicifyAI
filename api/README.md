# VoicifyAI Local API — bước 1–2

## Cài đặt và chạy

```powershell
python -m pip install -r requirements.txt -r api/requirements.txt
python -m uvicorn api.main:app --host 127.0.0.1 --port 8765
```

Swagger UI có tại `http://127.0.0.1:8765/docs`.

Model được lazy-load ở request nhận diện đầu tiên. Nếu dùng tên model (ví dụ
`tiny.en`), faster-whisper sẽ tải model từ Hugging Face khi model chưa có trong cache.

## Chạy thử engine trực tiếp

```powershell
python -m api.engine tests/data/jfk.flac --model tiny.en --device cpu --compute-type int8
```

## Gọi REST API

```powershell
curl.exe http://127.0.0.1:8765/v1/health
curl.exe http://127.0.0.1:8765/v1/models
curl.exe -X POST http://127.0.0.1:8765/v1/transcribe/batch `
  -F "audio=@tests/data/jfk.flac;type=audio/flac" `
  --form-string 'config={"model":"tiny.en","device":"cpu","quantization":"int8"}'
```

`config` là một JSON string trong multipart form. `language` để `null` hoặc bỏ qua
để Whisper tự nhận diện. `task="translate"` chỉ dịch sang tiếng Anh, đúng giới hạn
của Whisper.

## Thu âm trực tiếp

Khi chạy desktop bằng `npm run tauri dev`, script development tự khởi động FastAPI
nếu cổng `8765` chưa có API. Trong ứng dụng, bật **Microphone**, **System Audio**
hoặc cả hai rồi nhấn **Bắt đầu**.

- Microphone được capture bằng `cpal`.
- System Audio dùng WASAPI loopback và chỉ có dữ liệu khi Windows đang phát âm thanh.
- Hai nguồn được giữ riêng để xử lý song song, sau đó ghép thành transcript liên tục theo thời gian.
- Audio được chuyển thành mono 16 kHz trong Rust, chia chunk 4 giây với overlap 0,5 giây.

## Đăng nhập Google

FastAPI local không xử lý Google OAuth. Đăng nhập được thực hiện trong Rust/Tauri bằng
OAuth Client loại Desktop app; xem [`docs/GOOGLE_OAUTH.md`](../docs/GOOGLE_OAUTH.md).
