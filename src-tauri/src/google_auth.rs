use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use keyring::Entry;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    env,
    io::{Read, Write},
    net::TcpListener,
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};
use url::Url;

const KEYRING_SERVICE: &str = "VoicifyAI.GoogleOAuth";
const KEYRING_USER: &str = "current-user";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
const GOOGLE_SCOPES: &str = concat!(
    "openid email profile ",
    "https://www.googleapis.com/auth/drive ",
    "https://www.googleapis.com/auth/spreadsheets ",
    "https://www.googleapis.com/auth/calendar"
);

#[derive(Clone, Copy, PartialEq)]
enum SignInPhase {
    WaitingForGoogle,
    Completing,
}

#[derive(Default)]
struct SignInState {
    next_id: u64,
    active: Option<(u64, SignInPhase)>,
}

fn sign_in_state() -> &'static Mutex<SignInState> {
    static STATE: OnceLock<Mutex<SignInState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(SignInState::default()))
}

fn begin_sign_in() -> u64 {
    let mut state = sign_in_state()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    state.next_id = state.next_id.wrapping_add(1);
    let attempt_id = state.next_id;
    state.active = Some((attempt_id, SignInPhase::WaitingForGoogle));
    attempt_id
}

fn is_sign_in_active(attempt_id: u64) -> bool {
    sign_in_state()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .active
        .is_some_and(|(active_id, _)| active_id == attempt_id)
}

fn mark_sign_in_completing(attempt_id: u64) -> bool {
    let mut state = sign_in_state()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    match state.active {
        Some((active_id, SignInPhase::WaitingForGoogle)) if active_id == attempt_id => {
            state.active = Some((attempt_id, SignInPhase::Completing));
            true
        }
        _ => false,
    }
}

fn finish_sign_in(attempt_id: u64) {
    let mut state = sign_in_state()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if state
        .active
        .is_some_and(|(active_id, _)| active_id == attempt_id)
    {
        state.active = None;
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleUser {
    pub id: String,
    pub name: String,
    pub email: String,
    pub picture: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleAuthStatus {
    pub configured: bool,
    pub user: Option<GoogleUser>,
}

#[derive(Deserialize, Serialize)]
struct StoredAuth {
    access_token: String,
    refresh_token: Option<String>,
    scope: String,
    user: GoogleUser,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    scope: Option<String>,
}

pub(crate) fn google_access_token() -> Result<String, String> {
    let mut auth = load_auth()
        .ok_or("Bạn chưa đăng nhập Google. Hãy đăng nhập trong Cài đặt để lưu meeting.")?;
    let Some(refresh_token) = auth.refresh_token.as_deref() else {
        return Ok(auth.access_token);
    };
    let client_id = client_id().ok_or("Cấu hình Google OAuth không còn khả dụng.")?;
    let secret = client_secret();
    let mut form = vec![
        ("client_id", client_id.as_str()),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];
    if let Some(secret) = secret.as_deref() {
        form.push(("client_secret", secret));
    }
    let response = reqwest::blocking::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(&form)
        .send()
        .map_err(|error| format!("Không thể làm mới phiên đăng nhập Google: {error}"))?;
    if !response.status().is_success() {
        let message = response.text().unwrap_or_default();
        return Err(format!(
            "Phiên đăng nhập Google đã hết hạn hoặc bị thu hồi: {message}"
        ));
    }
    let token: TokenResponse = response
        .json()
        .map_err(|error| format!("Token Google không hợp lệ: {error}"))?;
    auth.access_token = token.access_token;
    if let Some(scope) = token.scope {
        auth.scope = scope;
    }
    save_auth(&auth)?;
    Ok(auth.access_token)
}

pub(crate) fn google_user_id() -> Result<String, String> {
    load_auth()
        .map(|auth| auth.user.id)
        .ok_or("Bạn chưa đăng nhập Google. Hãy đăng nhập trong Cài đặt để lưu meeting.".to_string())
}

pub(crate) fn current_google_user_id() -> Option<String> {
    load_auth().map(|auth| auth.user.id)
}

#[derive(Deserialize)]
struct UserInfo {
    sub: String,
    name: Option<String>,
    email: Option<String>,
    picture: Option<String>,
}

fn client_id() -> Option<String> {
    configured_value(
        env::var("GOOGLE_OAUTH_CLIENT_ID").ok(),
        option_env!("GOOGLE_OAUTH_CLIENT_ID"),
    )
}

fn client_secret() -> Option<String> {
    configured_value(
        env::var("GOOGLE_OAUTH_CLIENT_SECRET").ok(),
        option_env!("GOOGLE_OAUTH_CLIENT_SECRET"),
    )
}

fn configured_value(runtime: Option<String>, compiled: Option<&str>) -> Option<String> {
    runtime
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            compiled
                .map(str::to_owned)
                .filter(|value| !value.trim().is_empty())
        })
}

fn credential() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|error| error.to_string())
}

fn load_auth() -> Option<StoredAuth> {
    credential()
        .ok()?
        .get_password()
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
}

fn save_auth(auth: &StoredAuth) -> Result<(), String> {
    let json = serde_json::to_string(auth).map_err(|error| error.to_string())?;
    credential()?
        .set_password(&json)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn google_auth_status() -> GoogleAuthStatus {
    GoogleAuthStatus {
        configured: client_id().is_some(),
        user: load_auth().map(|auth| auth.user),
    }
}

#[tauri::command]
pub async fn google_sign_in() -> Result<GoogleUser, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let attempt_id = begin_sign_in();
        let result = sign_in(attempt_id);
        finish_sign_in(attempt_id);
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn google_cancel_sign_in() -> bool {
    let mut state = sign_in_state()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if matches!(state.active, Some((_, SignInPhase::WaitingForGoogle))) {
        state.active = None;
        true
    } else {
        false
    }
}

fn sign_in(attempt_id: u64) -> Result<GoogleUser, String> {
    let client_id = client_id().ok_or(
        "Chưa cấu hình GOOGLE_OAUTH_CLIENT_ID. Hãy tạo OAuth Client loại Desktop app trong Google Cloud Console.",
    )?;
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("Không thể mở cổng đăng nhập cục bộ: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let verifier = random_urlsafe(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_urlsafe(32);
    let mut auth_url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth")
        .map_err(|error| error.to_string())?;
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", GOOGLE_SCOPES)
        .append_pair("access_type", "offline")
        .append_pair("include_granted_scopes", "true")
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("prompt", "consent select_account");

    open::that(auth_url.as_str())
        .map_err(|error| format!("Không thể mở trình duyệt đăng nhập: {error}"))?;
    let code = wait_for_callback(&listener, &state, attempt_id)?;
    if !mark_sign_in_completing(attempt_id) {
        return Err("Đăng nhập Google đã bị hủy.".to_string());
    }

    let client = reqwest::blocking::Client::new();
    let mut form = vec![
        ("client_id", client_id.as_str()),
        ("code", code.as_str()),
        ("code_verifier", verifier.as_str()),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri.as_str()),
    ];
    let secret = client_secret();
    if let Some(secret) = secret.as_deref() {
        form.push(("client_secret", secret));
    }
    let token_response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&form)
        .send()
        .map_err(|error| format!("Không thể đổi mã đăng nhập: {error}"))?;
    if !token_response.status().is_success() {
        let message = token_response.text().unwrap_or_default();
        return Err(format!("Google từ chối mã đăng nhập: {message}"));
    }
    let token: TokenResponse = token_response
        .json()
        .map_err(|error| format!("Phản hồi token không hợp lệ: {error}"))?;
    let user_response = client
        .get("https://openidconnect.googleapis.com/v1/userinfo")
        .bearer_auth(&token.access_token)
        .send()
        .map_err(|error| format!("Không thể đọc hồ sơ Google: {error}"))?;
    if !user_response.status().is_success() {
        return Err("Google không trả về hồ sơ người dùng.".to_string());
    }
    let profile: UserInfo = user_response
        .json()
        .map_err(|error| format!("Hồ sơ Google không hợp lệ: {error}"))?;
    let user = GoogleUser {
        id: profile.sub,
        name: profile
            .name
            .unwrap_or_else(|| "Người dùng Google".to_string()),
        email: profile.email.unwrap_or_default(),
        picture: profile.picture,
    };
    save_auth(&StoredAuth {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        scope: token.scope.unwrap_or_else(|| GOOGLE_SCOPES.to_string()),
        user: user.clone(),
    })?;
    Ok(user)
}

fn wait_for_callback(
    listener: &TcpListener,
    expected_state: &str,
    attempt_id: u64,
) -> Result<String, String> {
    let started = Instant::now();
    while started.elapsed() < LOGIN_TIMEOUT {
        if !is_sign_in_active(attempt_id) {
            return Err("Đăng nhập Google đã bị hủy.".to_string());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
                let mut buffer = [0_u8; 16_384];
                let size = stream
                    .read(&mut buffer)
                    .map_err(|error| error.to_string())?;
                let request = String::from_utf8_lossy(&buffer[..size]);
                let target = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .ok_or("Callback Google không hợp lệ")?;
                let callback_result = parse_callback_target(target, expected_state);
                let (status, body) = if callback_result.is_ok() {
                    (
                        "200 OK",
                        "Đăng nhập VoicifyAI thành công. Bạn có thể đóng cửa sổ này.",
                    )
                } else {
                    (
                        "400 Bad Request",
                        "Đăng nhập không thành công. Vui lòng quay lại VoicifyAI và thử lại.",
                    )
                };
                let html = format!("<!doctype html><meta charset=utf-8><title>VoicifyAI</title><body style='font-family:system-ui;padding:40px'><h2>{body}</h2></body>");
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}",
                    html.len()
                );
                let _ = stream.write_all(response.as_bytes());
                return callback_result;
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Đã hết thời gian chờ đăng nhập Google.".to_string())
}

fn parse_callback_target(target: &str, expected_state: &str) -> Result<String, String> {
    let callback =
        Url::parse(&format!("http://127.0.0.1{target}")).map_err(|error| error.to_string())?;
    let params: std::collections::HashMap<_, _> = callback.query_pairs().into_owned().collect();
    if params.get("state").map(String::as_str) != Some(expected_state) {
        return Err("Mã bảo vệ đăng nhập không khớp. Vui lòng thử lại.".to_string());
    }
    if let Some(error) = params.get("error") {
        return Err(format!("Google không cấp quyền: {error}"));
    }
    params
        .get("code")
        .cloned()
        .ok_or("Google không trả về mã đăng nhập".to_string())
}

fn random_urlsafe(byte_count: usize) -> String {
    let mut bytes = vec![0_u8; byte_count];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

#[tauri::command]
pub async fn google_sign_out() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        if let Some(auth) = load_auth() {
            let _ = reqwest::blocking::Client::new()
                .post("https://oauth2.googleapis.com/revoke")
                .form(&[(
                    "token",
                    auth.refresh_token.as_deref().unwrap_or(&auth.access_token),
                )])
                .send();
        }
        match credential()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oauth_config_prefers_runtime_and_ignores_blank_values() {
        assert_eq!(
            configured_value(Some("runtime-client".to_string()), Some("compiled-client")),
            Some("runtime-client".to_string())
        );
        assert_eq!(
            configured_value(Some("  ".to_string()), Some("compiled-client")),
            Some("compiled-client".to_string())
        );
        assert_eq!(configured_value(None, Some("")), None);
    }

    #[test]
    fn login_requests_google_workspace_scopes() {
        assert!(GOOGLE_SCOPES.contains("/auth/drive"));
        assert!(GOOGLE_SCOPES.contains("/auth/spreadsheets"));
        assert!(GOOGLE_SCOPES.contains("/auth/calendar"));
    }

    #[test]
    fn callback_parser_accepts_matching_state_and_code() {
        assert_eq!(
            parse_callback_target("/?state=expected&code=auth-code", "expected"),
            Ok("auth-code".to_string())
        );
    }

    #[test]
    fn callback_parser_rejects_state_mismatch() {
        let error = parse_callback_target("/?state=wrong&code=auth-code", "expected")
            .expect_err("state khác phải bị từ chối");
        assert!(error.contains("không khớp"));
    }

    #[test]
    fn callback_parser_reports_google_denial() {
        let error = parse_callback_target("/?state=expected&error=access_denied", "expected")
            .expect_err("Google error phải được trả về");
        assert!(error.contains("access_denied"));
    }

    #[test]
    fn pending_sign_in_can_be_cancelled() {
        let attempt_id = begin_sign_in();
        assert!(is_sign_in_active(attempt_id));
        assert!(google_cancel_sign_in());
        assert!(!is_sign_in_active(attempt_id));
        assert!(!google_cancel_sign_in());
    }
}
