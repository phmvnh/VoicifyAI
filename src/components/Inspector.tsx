import { AlertCircle, ChevronRight, Cpu, Download, Gauge, HardDrive, Languages, LoaderCircle, Sparkles, Trash2, X, Zap } from "lucide-react";
import { useEffect, useMemo } from "react";
import { providerLabel } from "../lib/aiSummary";
import type { AiSummaryConfigStatus, EngineConfig, GpuRuntimeStatus, HardwareStatus, ModelStatus, TranscriptionResult } from "../types";
import type { LanguageOption } from "../lib/languages";
import { formatModelBytes, ModelDropdown } from "./ModelDropdown";
import { Toggle } from "./Toggle";

interface InspectorProps {
  config: EngineConfig;
  setConfig: (config: EngineConfig) => void;
  models: string[];
  languages: LanguageOption[];
  result: TranscriptionResult | null;
  recording: boolean;
  engineBusy: boolean;
  onOpenSummarySettings: () => void;
  aiSummaryConfig: AiSummaryConfigStatus;
  hardwareStatus: HardwareStatus | null;
  gpuRuntimeStatus: GpuRuntimeStatus | null;
  modelStatuses: ModelStatus[];
  onDownloadModel: (model: string) => void;
  onCancelModelDownload: (model: string) => void;
  onRemoveModel: (model: string) => void;
  onInstallGpuRuntime: () => void;
  onCancelGpuRuntimeInstall: () => void;
  onRemoveGpuRuntime: () => void;
}

const computeTypeLabels: Record<string, string> = {
  default: "Tự động",
  int8: "int8 · Tiết kiệm bộ nhớ",
  int8_float32: "int8 + float32",
  int8_float16: "int8 + float16 · Tiết kiệm VRAM",
  int8_bfloat16: "int8 + bfloat16",
  float16: "float16 · Khuyên dùng",
  bfloat16: "bfloat16",
  float32: "float32 · Chính xác, tốn bộ nhớ",
};

const cpuFallbackTypes = ["int8", "int8_float32", "float32"];
const cudaFallbackTypes = ["float16", "int8_float16", "int8", "float32"];
const computeTypeOrder = ["float16", "int8_float16", "int8", "bfloat16", "int8_bfloat16", "int8_float32", "float32"];

export function Inspector({ config, setConfig, models, languages, result, recording, engineBusy, onOpenSummarySettings, aiSummaryConfig, hardwareStatus, gpuRuntimeStatus, modelStatuses, onDownloadModel, onCancelModelDownload, onRemoveModel, onInstallGpuRuntime, onCancelGpuRuntimeInstall, onRemoveGpuRuntime }: InspectorProps) {
  const patch = (value: Partial<EngineConfig>) => setConfig({ ...config, ...value });
  const supportedComputeTypes = useMemo(() => config.device === "auto"
    ? ["default"]
    : config.device === "cpu"
      ? hardwareStatus?.cpu?.compute_types?.length ? hardwareStatus.cpu.compute_types : cpuFallbackTypes
      : hardwareStatus?.cuda.compute_types.length ? hardwareStatus.cuda.compute_types : cudaFallbackTypes,
    [config.device, hardwareStatus]);
  const quantizationOptions = [
    "default",
    ...computeTypeOrder.filter((type) => supportedComputeTypes.includes(type)),
  ];
  useEffect(() => {
    if (config.quantization === "default" || supportedComputeTypes.includes(config.quantization)) return;
    const fallback = config.device === "cpu"
      ? "int8"
      : config.device === "cuda" && supportedComputeTypes.includes("float16")
        ? "float16"
        : "default";
    setConfig({ ...config, quantization: fallback });
  }, [config, setConfig, supportedComputeTypes]);
  const changeDevice = (device: EngineConfig["device"]) => {
    const supported = device === "auto"
      ? ["default"]
      : device === "cpu"
        ? hardwareStatus?.cpu?.compute_types?.length ? hardwareStatus.cpu.compute_types : cpuFallbackTypes
        : hardwareStatus?.cuda.compute_types.length ? hardwareStatus.cuda.compute_types : cudaFallbackTypes;
    const fallback = device === "cpu"
      ? "int8"
      : device === "cuda" && supported.includes("float16")
        ? "float16"
        : "default";
    patch({
      device,
      quantization: config.quantization === "default" || supported.includes(config.quantization)
        ? config.quantization
        : fallback,
    });
  };
  const operationNotice = modelStatuses.find((status) => status.error)
    ?? modelStatuses.find((status) => status.downloading);
  const cudaReady = hardwareStatus?.cuda.available === true;
  const gpuDetected = (hardwareStatus?.cuda.device_count ?? 0) > 0;
  const runtimeBusy = gpuRuntimeStatus?.installing || gpuRuntimeStatus?.removing;
  const runtimeSize = formatModelBytes(gpuRuntimeStatus?.size_bytes || gpuRuntimeStatus?.estimated_download_bytes || 0);
  const showGpuRuntime = config.device === "cuda";

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
        <ModelDropdown
          models={models}
          statuses={modelStatuses}
          selectedModel={config.model}
          disabled={recording}
          taskRunning={engineBusy}
          onSelect={(model) => patch({ model })}
          onDownload={onDownloadModel}
          onCancelDownload={onCancelModelDownload}
          onRemove={onRemoveModel}
        />
        {operationNotice && (
          <div className={`model-operation-notice ${operationNotice.error ? "failed" : "downloading"}`}>
            <span>{operationNotice.error ? <AlertCircle size={15} /> : <LoaderCircle className="spin" size={15} />}</span>
            <span>
              <strong>{operationNotice.error ? (operationNotice.error_operation === "remove" ? "Không thể gỡ model" : "Tải model thất bại") : `Đang tải ${operationNotice.label}…`}</strong>
              <small>{operationNotice.error ?? `${formatModelBytes(operationNotice.size_bytes)}${operationNotice.total_bytes ? ` / ${formatModelBytes(operationNotice.total_bytes)}` : " đã tải"}`}</small>
            </span>
            {operationNotice.error && <button type="button" onClick={() => operationNotice.error_operation === "remove" ? onRemoveModel(operationNotice.id) : onDownloadModel(operationNotice.id)}>{operationNotice.error_operation === "remove" ? "Thử gỡ lại" : "Thử lại"}</button>}
          </div>
        )}
        <span className="field-caption">Thiết bị xử lý</span>
        <div className="device-segmented" role="group" aria-label="Thiết bị xử lý">
          <button type="button" className={config.device === "auto" ? "active" : ""} disabled={recording} onClick={() => changeDevice("auto")}>Tự động</button>
          <button type="button" className={config.device === "cpu" ? "active" : ""} disabled={recording} onClick={() => changeDevice("cpu")}><Cpu size={12} /> CPU</button>
          <button type="button" className={config.device === "cuda" ? "active" : ""} disabled={recording || !hardwareStatus || (!gpuDetected && !cudaReady)} title={!hardwareStatus ? "Đang kiểm tra GPU…" : !gpuDetected && !cudaReady ? "Không phát hiện GPU NVIDIA" : !cudaReady ? "Chọn GPU và cài thành phần tăng tốc" : "Dùng GPU NVIDIA"} onClick={() => changeDevice("cuda")}><Zap size={12} /> GPU</button>
        </div>

        {showGpuRuntime && <div className={`gpu-runtime-card ${cudaReady ? "ready" : gpuDetected ? "needs-runtime" : "unavailable"} ${gpuRuntimeStatus?.error ? "has-error" : ""}`}>
          <span className="gpu-runtime-icon">{runtimeBusy ? <LoaderCircle className="spin" size={16} /> : <Zap size={16} />}</span>
          <span className="gpu-runtime-copy">
            <strong>{gpuRuntimeStatus?.installing ? "Đang cài tăng tốc GPU…" : gpuRuntimeStatus?.removing ? "Đang gỡ tăng tốc GPU…" : gpuRuntimeStatus?.error ? "Cài tăng tốc GPU thất bại" : cudaReady ? "GPU NVIDIA sẵn sàng" : gpuDetected ? "Cần cài tăng tốc GPU" : hardwareStatus ? "Không phát hiện GPU NVIDIA" : "Đang kiểm tra GPU…"}</strong>
            <small>{gpuRuntimeStatus?.error ?? (gpuRuntimeStatus?.installing ? "Đang tải và cài đặt thư viện cần thiết" : cudaReady ? `${gpuRuntimeStatus?.installed ? `Runtime của VoicifyAI · ${runtimeSize}` : "Dùng CUDA có sẵn trên máy"}` : gpuDetected ? `CUDA ${gpuRuntimeStatus?.version ?? "12"} + cuDNN · ${runtimeSize}` : "App sẽ tiếp tục sử dụng CPU")}</small>
          </span>
          {gpuRuntimeStatus?.installing ? (
            <button type="button" className="gpu-runtime-action icon" onClick={onCancelGpuRuntimeInstall} aria-label="Huỷ cài tăng tốc GPU" title="Huỷ"><X size={14} /></button>
          ) : gpuRuntimeStatus?.installed ? (
            <button type="button" className="gpu-runtime-action icon danger" disabled={recording || engineBusy || gpuRuntimeStatus.removing} onClick={onRemoveGpuRuntime} aria-label="Gỡ thành phần tăng tốc GPU" title={recording || engineBusy ? "Không thể gỡ khi đang nhận diện" : "Gỡ thành phần tăng tốc GPU"}><Trash2 size={14} /></button>
          ) : gpuDetected && !cudaReady ? (
            <button type="button" className="gpu-runtime-action icon" disabled={runtimeBusy} onClick={onInstallGpuRuntime} aria-label="Cài thành phần tăng tốc GPU" title="Cài thành phần tăng tốc GPU"><Download size={14} /></button>
          ) : null}
          {gpuRuntimeStatus?.installing && <span className="gpu-runtime-progress"><i style={{ width: `${Math.max(1, Math.min(100, (gpuRuntimeStatus.progress ?? 0) * 100))}%` }} /></span>}
        </div>}

        <label className="performance-field">Chế độ hiệu năng<select value={config.quantization} disabled={recording} onChange={(event) => patch({ quantization: event.target.value })}>{quantizationOptions.map((type) => <option key={type} value={type}>{computeTypeLabels[type] ?? type}</option>)}</select></label>
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
        </div>
      </section>

    </aside>
  );
}
