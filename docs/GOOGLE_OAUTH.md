# Google OAuth cho VoicifyAI Desktop và Web

VoicifyAI dùng hai OAuth Client riêng cho hai runtime. Desktop xử lý OAuth trong
Rust/Tauri; bản web dùng Google Identity Services trong trình duyệt. FastAPI chạy
local tại `127.0.0.1:8765` không tham gia đăng nhập Google.

## Kiến trúc hiện tại

Luồng đăng nhập:

1. React gọi Tauri command `google_sign_in`.
2. Rust mở trình duyệt hệ thống tới trang ủy quyền của Google.
3. Google callback về listener loopback `http://127.0.0.1:<random-port>`.
4. Rust xác minh `state`, đổi authorization code bằng PKCE S256 và đọc hồ sơ từ
   Google UserInfo.
5. Access token, refresh token cũ nếu có, cùng hồ sơ người dùng được lưu trong OS
   keyring. Token không được trả về React/TypeScript.

Mỗi lần đăng nhập tạo một cổng callback ngẫu nhiên, một PKCE verifier/challenge mới và
một giá trị `state` ngẫu nhiên bằng nguồn ngẫu nhiên mật mã.

## Cấu hình Google Cloud

1. Tạo hoặc chọn Google Cloud project dùng cho VoicifyAI.
2. Cấu hình OAuth consent screen.
3. Tạo OAuth Client ID với **Application type = Desktop app**. Không chọn Web
   application cho kiến trúc hiện tại.
4. Đặt public client ID vào biến môi trường:

   ```env
   GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=your-desktop-client-secret
   ```

Khi chạy qua `npm run tauri dev` hoặc `npm run tauri build`, script Tauri đọc file
`.env` ở thư mục repo và truyền biến này cho Cargo. Build của công ty cũng có thể đặt
trực tiếp các biến môi trường trên.

Google mô tả `client_secret` là tùy chọn đối với installed app, nhưng một số Desktop
client thực tế từ chối token exchange nếu thiếu tham số này. Vì vậy VoicifyAI gửi
`GOOGLE_OAUTH_CLIENT_SECRET` khi nó được cung cấp để đảm bảo tương thích. Desktop/native
app vẫn là public client: giá trị nhúng trong executable có thể bị trích xuất và tuyệt
đối không được xem là ranh giới bảo mật. PKCE S256 mới bảo vệ authorization code; token
exchange còn gửi client ID, redirect URI và grant type.

## Cấu hình bản web

1. Trong cùng Google Cloud project, tạo thêm OAuth Client ID với **Application
   type = Web application**. Không dùng Desktop Client ID cho bản web.
2. Thêm hostname HTTPS của VoicifyAI vào **Authorized JavaScript origins**.
3. Khai báo Client ID trong `.env`:

   ```env
   VITE_GOOGLE_WEB_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
   ```

4. Khởi động lại Vite sau khi sửa `.env`.

Google không chấp nhận raw IP là JavaScript origin, vì vậy
`https://10.59.69.84:1420` dù dùng được microphone nhưng không thể dùng là
OAuth Web origin. Cần truy cập qua hostname HTTPS hợp lệ (hoặc `localhost` khi
chạy ngay trên máy client) và khai báo đúng origin đó trong Google Cloud.

Bản web giữ access token trong `sessionStorage`; token hết khi phiên tab hết hoặc
hết hạn. Client secret không được đưa vào frontend.

OAuth client thuộc về Google Cloud project, không thuộc riêng tài khoản Gmail đã bấm
tạo project. Quyền sở hữu/quản trị project có thể được chia sẻ hoặc chuyển cho tài
khoản Google của công ty mà không cần đổi OAuth client ID, miễn là client/project đó
vẫn được giữ nguyên.

## Scope và token

Đăng nhập yêu cầu các scope nhận diện và Google Workspace trong cùng một lần consent:

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/drive`
- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/calendar`

Flow dùng `access_type=offline` và buộc hiển thị consent để nhận refresh token, nhờ đó
các tích hợp Drive, Sheets và Calendar vẫn hoạt động sau khi access token ngắn hạn hết
hạn. Các API tương ứng phải được bật trong cùng Google Cloud project và các scope phải
được khai báo trên OAuth consent screen.

Logout cố gắng revoke refresh token khi có, nếu không thì revoke access token. Lỗi mạng
khi gọi revoke không ngăn ứng dụng xóa credential cục bộ khỏi OS keyring.

## Lưu ý phát triển

- Không commit `.env` hoặc OAuth credential thật.
- Không đưa Google access/refresh token vào React state, localStorage hoặc log.
- Không dùng embedded webview cho trang đăng nhập; luôn dùng trình duyệt hệ thống.
- FastAPI OAuth trùng lặp và kiến trúc credential JSON trước đây đã được loại bỏ.

Nếu VoicifyAI sau này có shared remote authentication backend, việc chuyển sang OAuth
Client loại **Web application**, HTTPS callback, user database và session riêng phải
được thiết kế như một migration độc lập. Kiến trúc đó không được dùng trong bản desktop
local hiện tại và không cần custom protocol/deep link cho flow loopback này.
