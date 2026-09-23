import { CalendarDays, ChevronRight, FileText, LoaderCircle, Mic2, MonitorSpeaker, Pause, Play, RefreshCw, Settings2, Square, Table2, UserRound } from "lucide-react";
import type { CaptureSource, RecentMeeting } from "../types";
import type { AudioDeviceInfo } from "../lib/liveAudioClient";
import type { GoogleUser } from "../lib/googleAuth";
import type { ArchiveMeetingOutput } from "../lib/meetingArchive";
import { LevelMeter } from "./LevelMeter";
import { Toggle } from "./Toggle";

interface SidebarProps {
  sessionName: string;
  setSessionName: (value: string) => void;
  onOpenSettings: () => void;
  hasResult: boolean;
  recentMeetings: RecentMeeting[];
  onSelectMeeting: (meetingId: string) => void;
  sources: Record<CaptureSource, boolean>;
  setSources: (sources: Record<CaptureSource, boolean>) => void;
  levels: Record<CaptureSource, number>;
  recording: boolean;
  paused: boolean;
  elapsed: number;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  microphones: AudioDeviceInfo[];
  microphoneDevice: string | null;
  onMicrophoneChange: (device: string) => void;
  onRefreshMicrophones: () => void;
  googleUser: GoogleUser | null;
  archiveLinks: ArchiveMeetingOutput | null;
  archiveLoading: boolean;
  onOpenArchive: (kind: "docs" | "sheet" | "calendar") => void;
  modelReady: boolean;
  blockedReason: string | null;
}

function formatTimer(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest].map((value) => value.toString().padStart(2, "0")).join(":");
}

export function Sidebar({
  sessionName,
  setSessionName,
  onOpenSettings,
  hasResult,
  recentMeetings,
  onSelectMeeting,
  sources,
  setSources,
  levels,
  recording,
  paused,
  elapsed,
  onStart,
  onPause,
  onStop,
  microphones,
  microphoneDevice,
  onMicrophoneChange,
  onRefreshMicrophones,
  googleUser,
  archiveLinks,
  archiveLoading,
  onOpenArchive,
  modelReady,
  blockedReason,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <button type="button" className="account-chip" onClick={onOpenSettings}>
        <span className="avatar">{googleUser?.picture ? <img src={googleUser.picture} alt="" referrerPolicy="no-referrer" /> : <UserRound size={17} />}</span>
        <span><strong>{googleUser?.name ?? "Tài khoản"}</strong><small>{googleUser?.email ?? "Chưa đăng nhập Google"}</small></span>
        <Settings2 size={16} />
      </button>

      <section>
        <h2>Nguồn thu</h2>
        <div className="sidebar-card capture-card">
          <div className="setting-row">
            <span className="source-icon"><Mic2 size={16} /></span>
            <span className="row-label">Microphone<small>Âm thanh từ microphone</small></span>
            <Toggle checked={sources.mic} onChange={(mic) => setSources({ ...sources, mic })} label="Microphone" disabled={recording} />
          </div>
          {sources.mic && (
            <div className="device-picker">
              <select
                value={microphoneDevice ?? ""}
                onChange={(event) => onMicrophoneChange(event.target.value)}
                disabled={recording || microphones.length === 0}
                aria-label="Chọn microphone"
              >
                {microphones.length === 0 ? (
                  <option value="">Không tìm thấy microphone</option>
                ) : microphones.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name}{device.isDefault ? " (Mặc định)" : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="Làm mới danh sách microphone"
                title="Làm mới danh sách"
                onClick={onRefreshMicrophones}
                disabled={recording}
              ><RefreshCw size={13} /></button>
            </div>
          )}
          <LevelMeter value={levels.mic} label="Mức microphone" />
          <div className="card-divider" />
          <div className="setting-row">
            <span className="source-icon violet"><MonitorSpeaker size={16} /></span>
            <span className="row-label">System Audio<small>Âm thanh từ máy tính</small></span>
            <Toggle checked={sources.system} onChange={(system) => setSources({ ...sources, system })} label="System Audio" disabled={recording} />
          </div>
          <LevelMeter value={levels.system} label="Mức system audio" />
        </div>
      </section>

      <section>
        <h2>Trạng thái</h2>
        <div className="sidebar-card status-card">
          <div className="status-line">
            <span className={`status-dot ${recording && !paused ? "recording" : "idle"}`} />
            <span>{recording ? (paused ? "Đang tạm dừng" : "Đang ghi âm") : !modelReady ? "Chưa sẵn sàng" : hasResult ? "Đã hoàn tất" : "Sẵn sàng"}</span>
            <time>{formatTimer(elapsed)}</time>
          </div>
          <label className="field-label" htmlFor="session-name">Tên phiên</label>
          <input
            id="session-name"
            value={sessionName}
            onChange={(event) => setSessionName(event.target.value)}
          />
          <div className="record-actions">
            {!recording ? (
              <button className="start-record" type="button" onClick={onStart} disabled={!modelReady} title={!modelReady ? blockedReason ?? undefined : undefined}><Play size={14} fill="currentColor" />Bắt đầu</button>
            ) : <>
              <button type="button" onClick={onPause}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? "Tiếp tục" : "Tạm dừng"}</button>
              <button className="stop-record" type="button" onClick={onStop}><Square size={12} fill="currentColor" />Dừng</button>
            </>}
          </div>
          <p className="fine-print">{!modelReady ? blockedReason : "Tạm dừng vẫn giữ phiên hiện tại. Chọn Dừng để hoàn tất."}</p>
        </div>
      </section>

      <section className="archive-section">
        <h2>Google Archive</h2>
        <div className="archive-actions" aria-label="Google Meeting Archive">
          <button type="button" className="archive-docs" disabled={!archiveLinks || archiveLoading} onClick={() => onOpenArchive("docs")}><FileText size={14} />Docs</button>
          <button type="button" className="archive-sheet" disabled={!googleUser || archiveLoading} onClick={() => onOpenArchive("sheet")}><Table2 size={14} />Sheet</button>
          <button type="button" className="archive-calendar" disabled={!googleUser || archiveLoading} onClick={() => onOpenArchive("calendar")}><CalendarDays size={14} />Calendar</button>
        </div>
        {archiveLoading && <p className="archive-status" role="status"><LoaderCircle className="spin" size={13} />Đang lưu vào Google…</p>}
      </section>

      <section className="recent-section">
        <h2>Gần đây</h2>
        {recentMeetings.length ? recentMeetings.map((meeting) => (
          <button className="recent-item" type="button" key={meeting.id} onClick={() => onSelectMeeting(meeting.id)} disabled={meeting.status !== "completed"}>
            <span>
              <strong>{meeting.title || "Phiên chưa đặt tên"}</strong>
              <small>{meeting.status === "recording" ? "Đang ghi âm" : meeting.status === "paused" ? "Đang tạm dừng" : meeting.summaryStatus === "failed" ? "Transcript đã lưu · Tóm tắt lỗi" : meeting.summaryStatus === "completed" ? "Đã có bản tóm tắt" : "Transcript đã lưu"}</small>
            </span>
            <ChevronRight size={14} />
          </button>
        )) : (
          <div className="recent-item empty-recent">
            <span><strong>Chưa có phiên nào</strong><small>Thu âm hoặc tải file để bắt đầu</small></span>
          </div>
        )}
      </section>

    </aside>
  );
}
