import { CircleStop, FileAudio, LoaderCircle, Mic2, MonitorSpeaker, Pause, Play, RotateCcw, Settings2, Sparkles, Upload } from "lucide-react";
import { useRef } from "react";
import type { CaptureSource, MainTab, TranscriptionResult } from "../types";

interface MainPanelProps {
  tab: MainTab;
  onTabChange: (tab: MainTab) => void;
  result: TranscriptionResult | null;
  loading: boolean;
  error: string | null;
  onFile: (file: File) => void;
  sessionName: string;
  model: string;
  device: string;
  quantization: string;
  sources: Record<CaptureSource, boolean>;
  levels: Record<CaptureSource, number>;
  recording: boolean;
  paused: boolean;
  elapsed: number;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  summaryText: string | null;
  summaryLoading: boolean;
  summaryError: string | null;
  aiSummaryConfigured: boolean;
  aiSummaryModel: string;
  onGenerateSummary: () => void;
  onOpenSummarySettings: () => void;
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function formatLiveTimer(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest].map((value) => value.toString().padStart(2, "0")).join(":");
}

export function MainPanel(props: MainPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const subtitle = props.result
    ? `${props.model} · ${props.quantization} · ${props.device} · ${formatDuration(props.result.duration)} · ${props.result.language.toUpperCase()} ${Math.round(props.result.language_probability * 100)}%`
    : `${props.model} · ${props.quantization} · ${props.device} · Chưa có bản ghi`;

  return (
    <main className="main-panel">
      <div className="main-toolbar">
        <div><h1>{props.sessionName || "Phiên chưa đặt tên"}</h1><p>{subtitle}</p></div>
        <div className="segmented" role="tablist" aria-label="Nội dung phiên">
          <button className={props.tab === "transcript" ? "active" : ""} onClick={() => props.onTabChange("transcript")} role="tab">Transcript</button>
          <button className={props.tab === "summary" ? "active" : ""} onClick={() => props.onTabChange("summary")} role="tab">Tóm tắt</button>
        </div>
      </div>

      <div className="capture-strip">
        <span className={`source-pill ${props.sources.mic ? "active" : "muted"}`}><Mic2 size={14} />Mic<i style={{ opacity: Math.max(.18, props.levels.mic) }} /></span>
        <span className={`source-pill ${props.sources.system ? "active violet" : "muted"}`}><MonitorSpeaker size={14} />System<i style={{ opacity: Math.max(.18, props.levels.system) }} /></span>
        {props.recording ? <>
          <time className="live-timer"><span />{formatLiveTimer(props.elapsed)}</time>
          <button
            className="strip-action pause-action"
            type="button"
            onClick={props.onPause}
            aria-label={props.paused ? "Tiếp tục thu" : "Tạm dừng thu"}
          >
            {props.paused ? <Play size={15} /> : <Pause size={15} />}
            <span>{props.paused ? "Tiếp tục" : "Tạm dừng"}</span>
          </button>
          <button className="strip-action stop" type="button" onClick={props.onStop} aria-label="Dừng và hoàn tất"><CircleStop size={16} /><span>Dừng</span></button>
        </> : <>
          <span className="capture-note">Thu trực tiếp hoặc mở file</span>
          <button className="live-button" type="button" onClick={props.onStart}><span />Thu âm</button>
          <button className="upload-button" type="button" onClick={() => inputRef.current?.click()} disabled={props.loading}>
            {props.loading ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
            {props.loading ? "Đang nhận diện…" : "Mở file"}
          </button>
        </>}
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,video/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) props.onFile(file);
            event.currentTarget.value = "";
          }}
        />
      </div>

      <div className="document-area">
        {props.tab === "transcript" ? (
          props.result ? (
            <article className="transcript" aria-live="polite">
              <div className="document-kicker"><FileAudio size={15} />{props.recording ? "Transcript trực tiếp" : "Bản chép lời"}</div>
              <p className="transcript-text">{props.result.text}</p>
            </article>
          ) : (
            <div className="empty-state">
              <span className="empty-icon"><AudioWaveIcon /></span>
              <h3>{props.recording ? "Đang lắng nghe…" : "Bắt đầu thu hoặc mở file âm thanh"}</h3>
              <p>{props.recording ? "Chunk đầu tiên sẽ xuất hiện sau khoảng 4 giây, tùy tốc độ model và thiết bị." : "Thu Microphone, System Audio, cả hai, hoặc chọn file MP3/WAV/FLAC."}</p>
              {!props.recording && <div className="empty-actions"><button type="button" className="record-empty" onClick={props.onStart}><Mic2 size={17} />Thu trực tiếp</button><button type="button" onClick={() => inputRef.current?.click()} disabled={props.loading}><Upload size={17} />Chọn file</button></div>}
              {props.error && <p className="error-message" role="alert">{props.error}</p>}
            </div>
          )
        ) : props.summaryText ? (
          <article className="summary-document" aria-live="polite">
            <div className="summary-document-header">
              <div><span className="summary-document-icon"><Sparkles size={17} /></span><span><strong>Bản tóm tắt AI</strong><small>{props.aiSummaryModel}</small></span></div>
              <button type="button" onClick={props.onGenerateSummary} disabled={props.summaryLoading}>{props.summaryLoading ? <LoaderCircle className="spin" size={14} /> : <RotateCcw size={14} />}{props.summaryLoading ? "Đang tạo…" : "Tạo lại"}</button>
            </div>
            <div className="summary-text">{props.summaryText}</div>
            {props.summaryError && <p className="error-message" role="alert">{props.summaryError}</p>}
          </article>
        ) : (
          <div className="empty-state summary-state">
            <span className="empty-icon purple"><Sparkles size={25} /></span>
            <h3>Tóm tắt transcript bằng AI</h3>
            <p>{props.summaryLoading ? "AI đang tạo bản tóm tắt…" : !props.result ? "Hãy thu âm hoặc mở file để có transcript trước khi tạo tóm tắt." : !props.aiSummaryConfigured ? "Kết nối Gemini, Grok, OpenAI hoặc Anthropic để bắt đầu." : `Đang sử dụng ${props.aiSummaryModel}.`}</p>
            {!props.aiSummaryConfigured ? <button type="button" onClick={props.onOpenSummarySettings}><Settings2 size={15} />Cấu hình AI</button> : <button type="button" disabled={!props.result || props.summaryLoading} onClick={props.onGenerateSummary}>{props.summaryLoading ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}{props.summaryLoading ? "Đang tạo tóm tắt…" : "Tạo bản tóm tắt"}</button>}
            {props.summaryError && <p className="error-message" role="alert">{props.summaryError}</p>}
          </div>
        )}
      </div>
    </main>
  );
}

function AudioWaveIcon() {
  return <div className="wave-icon" aria-hidden="true">{[10, 22, 34, 18, 28, 12].map((height, index) => <i key={index} style={{ height }} />)}</div>;
}
