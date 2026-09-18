import { ChevronRight, Gauge, HardDrive, Languages, Sparkles } from "lucide-react";
import { providerLabel } from "../lib/aiSummary";
import type { AiSummaryConfigStatus, EngineConfig, TranscriptionResult } from "../types";
import type { LanguageOption } from "../lib/languages";
import { Toggle } from "./Toggle";

interface InspectorProps {
  config: EngineConfig;
  setConfig: (config: EngineConfig) => void;
  models: string[];
  languages: LanguageOption[];
  result: TranscriptionResult | null;
  recording: boolean;
  onOpenSummarySettings: () => void;
  aiSummaryConfig: AiSummaryConfigStatus;
}

export function Inspector({ config, setConfig, models, languages, result, recording, onOpenSummarySettings, aiSummaryConfig }: InspectorProps) {
  const patch = (value: Partial<EngineConfig>) => setConfig({ ...config, ...value });

  return (
    <aside className="inspector">
      <section>
        <div className="section-title"><Sparkles size={15} /><h2>AI Summary</h2></div>
        <button type="button" className="summary-config-trigger" onClick={onOpenSummarySettings}>
          <span className="summary-trigger-icon"><Sparkles size={16} /></span>
          <span><strong>{aiSummaryConfig.configured ? `${providerLabel(aiSummaryConfig.provider)} · ${aiSummaryConfig.model}` : "Cấu hình API"}</strong><small>Gemini, Grok, OpenAI, Anthropic</small></span>
          <span className={`summary-trigger-status ${aiSummaryConfig.configured ? "configured" : ""}`}>{aiSummaryConfig.configured ? "Đã cấu hình" : "Chưa cấu hình"}</span>
          <ChevronRight size={15} />
        </button>
        <p className="hint">Chọn model AI dùng để tạo bản tóm tắt.</p>
      </section>

      <section>
        <div className="section-title"><HardDrive size={15} /><h2>Model & Hiệu năng</h2></div>
        <label>Model<select value={config.model} disabled={recording} onChange={(event) => patch({ model: event.target.value })}>{models.map((model) => <option key={model}>{model}</option>)}</select></label>
        <div className="two-fields">
          <label>Thiết bị<select value={config.device} disabled={recording} onChange={(event) => patch({ device: event.target.value as EngineConfig["device"] })}><option value="auto">Tự động</option><option value="cpu">CPU</option><option value="cuda">CUDA</option></select></label>
          <label>Định lượng<select value={config.quantization} disabled={recording} onChange={(event) => patch({ quantization: event.target.value })}><option value="default">Mặc định</option><option value="int8">int8</option><option value="float32">float32</option><option value="float16">float16</option><option value="int8_float16">int8_float16</option></select></label>
        </div>
        {config.device === "cuda" && <p className="hint warning">CUDA cần runtime NVIDIA; hiện chưa được xác minh trên máy này.</p>}
      </section>

      <section>
        <div className="section-title"><Gauge size={15} /><h2>Chỉ số lần chạy</h2></div>
        <div className="metrics">
          <div><span>RTF</span><strong>{result ? result.rtf.toFixed(3) : "—"}</strong></div>
          <div><span>Độ trễ</span><strong>{result ? `${result.inference_seconds.toFixed(2)}s` : "—"}</strong></div>
          <div><span>VRAM</span><strong>Chưa đo</strong></div>
        </div>
        <p className="hint">RTF và độ trễ là số đo thật của lần nhận diện gần nhất.</p>
      </section>

      <section>
        <div className="section-title"><Languages size={15} /><h2>Xử lý</h2></div>
        <label>Ngôn ngữ nhận diện
          <select
            value={config.language ?? "auto"}
            disabled={recording}
            onChange={(event) => patch({ language: event.target.value === "auto" ? null : event.target.value })}
          >
            <option value="auto">Tự động nhận diện</option>
            {(config.model.endsWith(".en")
              ? languages.filter((item) => item.code === "en")
              : languages
            ).map((item) => <option key={item.code} value={item.code}>{item.name} ({item.code})</option>)}
          </select>
        </label>
        {config.model.endsWith(".en") && <p className="hint warning">Model {config.model} chỉ hỗ trợ tiếng Anh.</p>}
        <div className="control-list">
          <div><span>Silero VAD<small>Lọc khoảng lặng</small></span><Toggle checked={config.vad_filter} onChange={(value) => patch({ vad_filter: value })} label="Silero VAD" /></div>
          <div><span>Dịch sang tiếng Anh<small>Whisper translate</small></span><Toggle checked={config.task === "translate"} onChange={(value) => patch({ task: value ? "translate" : "transcribe" })} label="Dịch sang tiếng Anh" /></div>
        </div>
      </section>

    </aside>
  );
}
