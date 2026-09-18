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
