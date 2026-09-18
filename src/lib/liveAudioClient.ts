import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CaptureSource, EngineConfig } from "../types";

export interface AudioLevelEvent {
  source: CaptureSource;
  level: number;
}

export interface CaptureStatusEvent {
  source: CaptureSource;
  active: boolean;
}

export interface CaptureErrorEvent {
  source: CaptureSource;
  message: string;
}

export interface LiveTranscriptEvent {
  type: "transcript";
  source: CaptureSource;
  text: string;
  start_sec: number;
  end_sec: number;
  language: string;
  language_probability: number;
  latency_seconds: number;
  rtf: number;
}

export interface AudioDeviceInfo {
  id: string;
  name: string;
  isDefault: boolean;
}

interface LiveEventHandlers {
  onLevel: (event: AudioLevelEvent) => void;
  onStatus: (event: CaptureStatusEvent) => void;
  onError: (event: CaptureErrorEvent) => void;
  onTranscript: (event: LiveTranscriptEvent) => void;
  onStreamFinished: (event: CaptureStatusEvent) => void;
}

export async function listenToLiveEvents(handlers: LiveEventHandlers): Promise<UnlistenFn> {
  const unlisteners = await Promise.all([
    listen<AudioLevelEvent>("audio-level", ({ payload }) => handlers.onLevel(payload)),
    listen<CaptureStatusEvent>("capture-status", ({ payload }) => handlers.onStatus(payload)),
    listen<CaptureErrorEvent>("capture-error", ({ payload }) => handlers.onError(payload)),
    listen<LiveTranscriptEvent>("transcript-segment", ({ payload }) => handlers.onTranscript(payload)),
    listen<CaptureStatusEvent>("transcript-stream-finished", ({ payload }) => handlers.onStreamFinished(payload)),
  ]);
  return () => unlisteners.forEach((unlisten) => unlisten());
}

export async function startLiveCapture(
  sources: CaptureSource[],
  config: EngineConfig,
  microphoneDevice: string | null,
): Promise<void> {
  const websocketUrl = import.meta.env.VITE_STREAM_URL ?? "ws://127.0.0.1:8765/v1/transcribe/stream";
  await invoke("start_capture", { sources, websocketUrl, config, microphoneDevice });
}

export async function listMicrophones(): Promise<AudioDeviceInfo[]> {
  return invoke<AudioDeviceInfo[]>("list_microphones");
}

export async function setLiveCapturePaused(paused: boolean): Promise<void> {
  await invoke("pause_capture", { paused });
}

export async function stopLiveCapture(): Promise<void> {
  await invoke("stop_capture");
}
