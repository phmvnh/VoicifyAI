export type CaptureSource = "mic" | "system";
export type MainTab = "transcript" | "summary";
export type ThemeMode = "light" | "dark" | "system";
export type AiProvider = "gemini" | "grok" | "openai" | "anthropic";
export type SummaryMode = "bullets" | "paragraph" | "actions" | "custom";
export type RecentMeetingStatus = "recording" | "paused" | "completed";

export interface RecentMeeting {
  id: string;
  title: string;
  status: RecentMeetingStatus;
  summaryStatus?: "pending" | "completed" | "failed";
}

export interface AiSummaryConfigStatus {
  provider: AiProvider;
  model: string;
  configured: boolean;
  configuredProviders: AiProvider[];
  storageError: string | null;
}

export interface SaveAiSummaryConfigInput {
  provider: AiProvider;
  model: string;
  apiKey: string;
}

export interface AiSummaryOutput {
  title: string;
  text: string;
  provider: AiProvider;
  model: string;
}

export interface WordResult {
  start: number;
  end: number;
  word: string;
  probability: number;
}

export interface SegmentResult {
  id: number;
  start: number;
  end: number;
  text: string;
  words: WordResult[] | null;
  source?: CaptureSource;
}

export interface TranscriptionResult {
  text: string;
  segments: SegmentResult[];
  language: string;
  language_probability: number;
  duration: number;
  duration_after_vad: number;
  inference_seconds: number;
  rtf: number;
}

export interface EngineConfig {
  model: string;
  device: "auto" | "cpu" | "cuda";
  quantization: string;
  language: string | null;
  task: "transcribe" | "translate";
  vad_filter: boolean;
  word_timestamps: boolean;
}

export interface HardwareStatus {
  cpu: {
    compute_types: string[];
    error: string | null;
  };
  cuda: {
    available: boolean;
    device_count: number;
    compute_types: string[];
    error: string | null;
  };
}

export interface GpuRuntimeStatus {
  installed: boolean;
  installing: boolean;
  cancel_requested: boolean;
  removing: boolean;
  progress: number;
  version: string;
  size_bytes: number;
  estimated_download_bytes: number;
  error: string | null;
}

export interface ModelStatus {
  id: string;
  label: string;
  description: string;
  downloaded: boolean;
  downloading: boolean;
  cancel_requested: boolean;
  removing: boolean;
  size_bytes: number;
  total_bytes: number | null;
  error: string | null;
  error_operation: "download" | "remove" | null;
}
