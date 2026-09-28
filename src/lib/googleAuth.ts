import { isTauriRuntime } from "./runtime";

export interface GoogleUser {
  id: string;
  name: string;
  email: string;
  picture: string | null;
}

export interface GoogleAuthStatus {
  configured: boolean;
  user: GoogleUser | null;
  configurationHint?: string;
}

interface WebGoogleAuth {
  accessToken: string;
  expiresAt: number;
  scope: string;
  user: GoogleUser;
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

interface GoogleOAuth2Api {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    include_granted_scopes?: boolean;
    callback: (response: GoogleTokenResponse) => void;
    error_callback?: (error: { type?: string }) => void;
  }): GoogleTokenClient;
  revoke(token: string, callback?: () => void): void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2Api } };
  }
}

const WEB_AUTH_KEY = "voicifyai-google-web-auth-v1";
const WEB_CLIENT_ID = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID?.trim() ?? "";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar",
].join(" ");

async function tauriInvoke<T>(command: string): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command);
}

function webOriginProblem(): string | null {
  const hostname = window.location.hostname;
  const rawIp = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
  if (rawIp && hostname !== "127.0.0.1") {
    return "Google OAuth Web không chấp nhận địa chỉ IP thô. Hãy truy cập VoicifyAI bằng hostname HTTPS đã khai báo trong Authorized JavaScript origins.";
  }
  if (window.location.protocol !== "https:" && hostname !== "localhost" && hostname !== "127.0.0.1") {
    return "Google OAuth Web yêu cầu HTTPS (ngoại trừ localhost).";
  }
  return null;
}

function webConfigurationHint(): string | undefined {
  if (!WEB_CLIENT_ID) {
    return "Bản web cần VITE_GOOGLE_WEB_CLIENT_ID của OAuth Client loại Web application.";
  }
  return webOriginProblem() ?? undefined;
}

function readWebAuth(): WebGoogleAuth | null {
  try {
    const auth = JSON.parse(sessionStorage.getItem(WEB_AUTH_KEY) ?? "null") as WebGoogleAuth | null;
    if (!auth || auth.expiresAt <= Date.now()) {
      sessionStorage.removeItem(WEB_AUTH_KEY);
      return null;
    }
    return auth;
  } catch {
    sessionStorage.removeItem(WEB_AUTH_KEY);
    return null;
  }
}

function loadGoogleIdentityServices(): Promise<GoogleOAuth2Api> {
  const loaded = window.google?.accounts?.oauth2;
  if (loaded) return Promise.resolve(loaded);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-voicify-google-identity]");
    const script = existing ?? document.createElement("script");
    const finish = () => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (oauth2) resolve(oauth2);
      else reject(new Error("Google Identity Services không khởi tạo được."));
    };
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("Không thể tải Google Identity Services.")), { once: true });
    if (!existing) {
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.voicifyGoogleIdentity = "true";
      document.head.appendChild(script);
    }
  });
}

export function getGoogleAuthStatus(): Promise<GoogleAuthStatus> {
  if (isTauriRuntime()) return tauriInvoke<GoogleAuthStatus>("google_auth_status");
  const hint = webConfigurationHint();
  return Promise.resolve({ configured: !hint, user: readWebAuth()?.user ?? null, configurationHint: hint });
}

export async function signInWithGoogle(): Promise<GoogleUser> {
  if (isTauriRuntime()) return tauriInvoke<GoogleUser>("google_sign_in");
  const hint = webConfigurationHint();
  if (hint) throw new Error(hint);
  const oauth2 = await loadGoogleIdentityServices();
  return new Promise<GoogleUser>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: WEB_CLIENT_ID,
      scope: GOOGLE_SCOPES,
      include_granted_scopes: true,
      error_callback: (error) => reject(new Error(`Không thể mở cửa sổ Google OAuth: ${error.type ?? "unknown"}.`)),
      callback: async (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || response.error || "Google không trả về access token."));
          return;
        }
        try {
          const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
            headers: { Authorization: `Bearer ${response.access_token}` },
          });
          if (!profileResponse.ok) throw new Error("Google không trả về hồ sơ người dùng.");
          const profile = await profileResponse.json() as { sub: string; name?: string; email?: string; picture?: string };
          const user: GoogleUser = {
            id: profile.sub,
            name: profile.name || "Người dùng Google",
            email: profile.email || "",
            picture: profile.picture || null,
          };
          sessionStorage.setItem(WEB_AUTH_KEY, JSON.stringify({
            accessToken: response.access_token,
            expiresAt: Date.now() + Math.max(0, (response.expires_in ?? 3600) - 30) * 1000,
            scope: response.scope ?? GOOGLE_SCOPES,
            user,
          } satisfies WebGoogleAuth));
          resolve(user);
        } catch (error) {
          reject(error);
        }
      },
    });
    client.requestAccessToken({ prompt: "consent" });
  });
}

export function cancelGoogleSignIn(): Promise<boolean> {
  if (!isTauriRuntime()) return Promise.resolve(false);
  return tauriInvoke<boolean>("google_cancel_sign_in");
}

export async function signOutGoogle(): Promise<void> {
  if (isTauriRuntime()) return tauriInvoke<void>("google_sign_out");
  const auth = readWebAuth();
  sessionStorage.removeItem(WEB_AUTH_KEY);
  if (!auth) return;
  const oauth2 = await loadGoogleIdentityServices().catch(() => null);
  await new Promise<void>((resolve) => {
    if (!oauth2) resolve();
    else oauth2.revoke(auth.accessToken, resolve);
  });
}
