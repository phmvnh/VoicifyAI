import { Bell, Check, Cpu, Laptop, LoaderCircle, Moon, Settings, Sun, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ThemeMode } from "../types";
import type { GoogleAuthStatus } from "../lib/googleAuth";
import { EngineGuide } from "./EngineGuide";

interface SettingsModalProps {
  onClose: () => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  googleAuth: GoogleAuthStatus;
  googleBusy: boolean;
  googleError: string | null;
  onGoogleSignIn: () => void;
  onGoogleSignOut: () => void;
}

export function SettingsModal({ onClose, theme, onThemeChange, googleAuth, googleBusy, googleError, onGoogleSignIn, onGoogleSignOut }: SettingsModalProps) {
  const [tab, setTab] = useState("account");
  const tabs = [
    ["account", "Tài khoản", UserRound], ["engine", "Model & Engine", Cpu],
    ["notification", "Thông báo", Bell], ["general", "Chung", Settings],
  ] as const;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header><div><h2 id="settings-title">Cài đặt</h2><p>Quản lý trải nghiệm VoicifyAI</p></div><button onClick={onClose} aria-label="Đóng cài đặt"><X size={18} /></button></header>
        <div className="settings-layout">
          <nav>{tabs.map(([key, label, Icon]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}><Icon size={16} />{label}</button>)}</nav>
          <div className="settings-content">
            {tab === "general" ? <>
              <h3>Giao diện</h3>
              <p className="settings-description">Chọn cách VoicifyAI hiển thị trên thiết bị này.</p>
              <div className="theme-picker" role="radiogroup" aria-label="Chế độ giao diện">
                <button
                  type="button"
                  className={theme === "light" ? "active" : ""}
                  role="radio"
                  aria-checked={theme === "light"}
                  onClick={() => onThemeChange("light")}
                >
                  <span className="theme-preview light-preview"><Sun size={18} /></span>
                  <strong>Sáng</strong>
                </button>
                <button
                  type="button"
                  className={theme === "dark" ? "active" : ""}
                  role="radio"
                  aria-checked={theme === "dark"}
                  onClick={() => onThemeChange("dark")}
                >
                  <span className="theme-preview dark-preview"><Moon size={18} /></span>
                  <strong>Tối</strong>
                </button>
                <button
                  type="button"
                  className={theme === "system" ? "active" : ""}
                  role="radio"
                  aria-checked={theme === "system"}
                  onClick={() => onThemeChange("system")}
                >
                  <span className="theme-preview system-preview"><Laptop size={18} /></span>
                  <strong>Hệ thống</strong>
                </button>
              </div>
              <p className="permission-note">Chế độ Hệ thống tự động đồng bộ với thiết lập giao diện của Windows.</p>
            </> : tab === "account" ? <>
              <h3>Tài khoản Google</h3>
              <div className="google-card">
                {googleAuth.user?.picture ? <img className="google-avatar" src={googleAuth.user.picture} alt="" referrerPolicy="no-referrer" /> : <span className="google-mark">G</span>}
                <div>
                  <strong>{googleAuth.user?.name ?? "Chưa đăng nhập"}</strong>
                  <p>{googleAuth.user?.email ?? (googleAuth.configured ? "Đăng nhập an toàn qua trình duyệt Google" : "Cần cấu hình OAuth Client trước khi đăng nhập")}</p>
                </div>
                <button
                  type="button"
                  className={googleAuth.user ? "disconnect-button" : "google-login-button"}
                  onClick={googleAuth.user ? onGoogleSignOut : onGoogleSignIn}
                  disabled={googleBusy || (!googleAuth.configured && !googleAuth.user)}
                >
                  {googleBusy && <LoaderCircle className="spin" size={14} />}
                  {googleBusy ? "Đang xử lý…" : googleAuth.user ? "Ngắt kết nối" : "Đăng nhập với Google"}
                </button>
              </div>
              {googleError && <p className="google-auth-error" role="alert">{googleError}</p>}
              <h3>Quyền truy cập</h3>
              <div className="permission-list">
                <div><span><strong>Hồ sơ cơ bản</strong><small>Tên, email và ảnh đại diện</small></span><span className={googleAuth.user ? "permission-status granted" : "permission-status"}>{googleAuth.user && <Check size={12} />}{googleAuth.user ? "Đã cấp" : "Chưa cấp"}</span></div>
                <div><span><strong>Google Drive</strong><small>Đọc, tạo và quản lý tệp trên Drive</small></span><span className={googleAuth.user ? "permission-status granted" : "permission-status"}>{googleAuth.user && <Check size={12} />}{googleAuth.user ? "Đã cấp" : "Chưa cấp"}</span></div>
                <div><span><strong>Calendar &amp; Sheets</strong><small>Quản lý lịch và bảng tính Google</small></span><span className={googleAuth.user ? "permission-status granted" : "permission-status"}>{googleAuth.user && <Check size={12} />}{googleAuth.user ? "Đã cấp" : "Chưa cấp"}</span></div>
              </div>
              <p className="permission-note">VoicifyAI xin các quyền hồ sơ, Drive, Sheets và Calendar trong cùng lần đăng nhập để sẵn sàng đồng bộ dữ liệu.</p>
            </> : tab === "engine" ? <EngineGuide /> : <div className="settings-placeholder"><h3>{tabs.find(([key]) => key === tab)?.[1]}</h3><p>Phần cài đặt này sẽ được hoàn thiện cùng module tương ứng.</p></div>}
          </div>
        </div>
      </div>
    </div>
  );
}
