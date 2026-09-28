import type { CaptureSource, EngineConfig } from "../types";
import { isTauriRuntime, webStreamUrl } from "./runtime";

export type UnlistenFn = () => void;

export interface AudioLevelEvent { source: CaptureSource; level: number; }
export interface CaptureStatusEvent { source: CaptureSource; active: boolean; }
export interface CaptureErrorEvent { source: CaptureSource; message: string; }
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
export interface AudioDeviceInfo { id: string; name: string; isDefault: boolean; }

interface LiveEventHandlers {
  onLevel: (event: AudioLevelEvent) => void;
  onStatus: (event: CaptureStatusEvent) => void;
  onError: (event: CaptureErrorEvent) => void;
  onTranscript: (event: LiveTranscriptEvent) => void;
  onStreamFinished: (event: CaptureStatusEvent) => void;
}

const webListeners = new Set<LiveEventHandlers>();
const TARGET_RATE = 16_000;
const CHUNK_SAMPLES = TARGET_RATE * 4;
const OVERLAP_SAMPLES = 8_000;
const STEP_SAMPLES = CHUNK_SAMPLES - OVERLAP_SAMPLES;

function emit<K extends keyof LiveEventHandlers>(name: K, payload: Parameters<LiveEventHandlers[K]>[0]) {
  for (const listener of webListeners) {
    (listener[name] as (value: typeof payload) => void)(payload);
  }
}

interface BrowserCapture {
  source: CaptureSource;
  stream: MediaStream;
  context: AudioContext;
  processor: ScriptProcessorNode;
  input: MediaStreamAudioSourceNode;
  mute: GainNode;
  socket: WebSocket;
  samples: number[];
  queue: Array<{ samples: Float32Array; start: number }>;
  chunkIndex: number;
  awaitingResponse: boolean;
  stopping: boolean;
  finished: boolean;
}

const browserCaptures = new Map<CaptureSource, BrowserCapture>();
let browserPaused = false;

function resample(input: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === TARGET_RATE) return new Float32Array(input);
  const outputLength = Math.max(1, Math.round(input.length * TARGET_RATE / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / TARGET_RATE;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[index] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

function audioPacket(samples: Float32Array, start: number): ArrayBuffer {
  const packet = new ArrayBuffer(8 + samples.length * 2);
  const view = new DataView(packet);
  view.setFloat64(0, start, true);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(8 + index * 2, Math.round(value * 32767), true);
  }
  return packet;
}

function finishBrowserCapture(capture: BrowserCapture) {
  if (capture.finished) return;
  capture.finished = true;
  browserCaptures.delete(capture.source);
  capture.processor.disconnect();
  capture.input.disconnect();
  capture.mute.disconnect();
  for (const track of capture.stream.getTracks()) track.stop();
  void capture.context.close();
  if (capture.socket.readyState === WebSocket.OPEN) capture.socket.close(1000, "capture-finished");
  emit("onLevel", { source: capture.source, level: 0 });
  emit("onStatus", { source: capture.source, active: false });
  emit("onStreamFinished", { source: capture.source, active: false });
}

function pumpBrowserCapture(capture: BrowserCapture) {
  if (capture.finished || capture.awaitingResponse || capture.socket.readyState !== WebSocket.OPEN) return;
  const next = capture.queue.shift();
  if (!next) {
    if (capture.stopping) finishBrowserCapture(capture);
    return;
  }
  capture.awaitingResponse = true;
  capture.socket.send(audioPacket(next.samples, next.start));
}

function queueAvailableChunks(capture: BrowserCapture) {
  while (capture.samples.length >= CHUNK_SAMPLES) {
    capture.queue.push({
      samples: Float32Array.from(capture.samples.slice(0, CHUNK_SAMPLES)),
      start: capture.chunkIndex * STEP_SAMPLES / TARGET_RATE,
    });
    capture.samples.splice(0, STEP_SAMPLES);
    capture.chunkIndex += 1;
  }
  pumpBrowserCapture(capture);
}

async function captureMedia(source: CaptureSource, microphoneDevice: string | null): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw new Error("Chrome chặn thu âm trên địa chỉ HTTP trong mạng LAN. Hãy dùng HTTPS hoặc cấu hình Chrome cho phép origin này khi thử nghiệm.");
  }
  if (!navigator.mediaDevices) throw new Error("Trình duyệt không cung cấp Web Audio/MediaDevices.");
  if (source === "mic") {
    return navigator.mediaDevices.getUserMedia({
      audio: microphoneDevice ? { deviceId: { exact: microphoneDevice } } : true,
      video: false,
    });
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  for (const videoTrack of stream.getVideoTracks()) videoTrack.stop();
  if (stream.getAudioTracks().length === 0) {
    for (const track of stream.getTracks()) track.stop();
    throw new Error("Nguồn được chia sẻ không có âm thanh. Hãy bật chia sẻ audio của tab hoặc màn hình.");
  }
  return stream;
}

async function startBrowserSource(source: CaptureSource, config: EngineConfig, microphoneDevice: string | null): Promise<void> {
  const stream = await captureMedia(source, microphoneDevice);
  const context = new AudioContext({ sampleRate: TARGET_RATE });
  await context.resume();
  const input = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const mute = context.createGain();
  mute.gain.value = 0;
  input.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(webStreamUrl());
    const capture: BrowserCapture = {
      source, stream, context, processor, input, mute, socket,
      samples: [], queue: [], chunkIndex: 0,
      awaitingResponse: false, stopping: false, finished: false,
    };
    browserCaptures.set(source, capture);
    let ready = false;

    const fail = (message: string) => {
      if (!ready) reject(new Error(message));
      else emit("onError", { source, message });
      finishBrowserCapture(capture);
    };

    socket.onopen = () => socket.send(JSON.stringify({ source, config }));
    socket.onerror = () => fail(`Không thể kết nối API streaming tại ${webStreamUrl()}.`);
    socket.onclose = (event) => {
      if (!capture.finished && !capture.stopping) fail(`Kết nối streaming đã đóng (${event.code}).`);
    };
    socket.onmessage = (event) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        fail("API streaming trả về dữ liệu không hợp lệ.");
        return;
      }
      if (message.type === "ready") {
        ready = true;
        emit("onStatus", { source, active: true });
        resolve();
        return;
      }
      capture.awaitingResponse = false;
      if (message.type === "error") {
        fail(String(message.message ?? "Lỗi streaming không xác định."));
        return;
      }
      if (message.type === "transcript") emit("onTranscript", message as unknown as LiveTranscriptEvent);
      pumpBrowserCapture(capture);
    };

    processor.onaudioprocess = (event) => {
      if (browserPaused || capture.stopping || capture.finished) return;
      const raw = event.inputBuffer.getChannelData(0);
      let sum = 0;
      for (const value of raw) sum += value * value;
      emit("onLevel", { source, level: Math.min(1, Math.sqrt(sum / raw.length) * 4) });
      capture.samples.push(...resample(raw, context.sampleRate));
      queueAvailableChunks(capture);
    };

    for (const track of stream.getAudioTracks()) {
      track.addEventListener("ended", () => {
        if (capture.stopping || capture.finished) return;
        capture.stopping = true;
        if (capture.samples.length >= TARGET_RATE / 2) {
          capture.queue.push({ samples: Float32Array.from(capture.samples), start: capture.chunkIndex * STEP_SAMPLES / TARGET_RATE });
        }
        capture.samples = [];
        pumpBrowserCapture(capture);
      });
    }
  });
}

export async function listenToLiveEvents(handlers: LiveEventHandlers): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    webListeners.add(handlers);
    return () => webListeners.delete(handlers);
  }
  const { listen } = await import("@tauri-apps/api/event");
  const unlisteners = await Promise.all([
    listen<AudioLevelEvent>("audio-level", ({ payload }) => handlers.onLevel(payload)),
    listen<CaptureStatusEvent>("capture-status", ({ payload }) => handlers.onStatus(payload)),
    listen<CaptureErrorEvent>("capture-error", ({ payload }) => handlers.onError(payload)),
    listen<LiveTranscriptEvent>("transcript-segment", ({ payload }) => handlers.onTranscript(payload)),
    listen<CaptureStatusEvent>("transcript-stream-finished", ({ payload }) => handlers.onStreamFinished(payload)),
  ]);
  return () => unlisteners.forEach((unlisten) => unlisten());
}

export async function startLiveCapture(sources: CaptureSource[], config: EngineConfig, microphoneDevice: string | null): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("start_capture", { sources, websocketUrl: webStreamUrl(), config, microphoneDevice });
    return;
  }
  browserPaused = false;
  try {
    for (const source of sources) await startBrowserSource(source, config, microphoneDevice);
  } catch (error) {
    await stopLiveCapture();
    throw error;
  }
}

export async function listMicrophones(): Promise<AudioDeviceInfo[]> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AudioDeviceInfo[]>("list_microphones");
  }
  if (!window.isSecureContext) {
    throw new Error("Không thể đọc microphone qua HTTP LAN. Trang cần được mở bằng HTTPS.");
  }
  if (!navigator.mediaDevices?.enumerateDevices) {
    throw new Error("Trình duyệt không hỗ trợ liệt kê microphone.");
  }
  // Browsers intentionally hide device labels and may expose only the default
  // input until the origin has been granted microphone permission.
  let permissionStream: MediaStream | null = null;
  try {
    permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      throw new Error("Chrome đang chặn quyền microphone. Hãy cho phép Microphone trong cài đặt của trang rồi nhấn làm mới.");
    }
    if (error instanceof DOMException && error.name === "NotFoundError") {
      throw new Error("Windows không cung cấp thiết bị microphone nào cho Chrome.");
    }
    throw error;
  } finally {
    permissionStream?.getTracks().forEach((track) => track.stop());
  }
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
  return devices.map((device, index) => ({
    id: device.deviceId,
    name: device.label || `Microphone ${index + 1}`,
    isDefault: device.deviceId === "default",
  }));
}

export async function setLiveCapturePaused(paused: boolean): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("pause_capture", { paused });
    return;
  }
  browserPaused = paused;
  if (paused) for (const source of browserCaptures.keys()) emit("onLevel", { source, level: 0 });
}

export async function stopLiveCapture(): Promise<void> {
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("stop_capture");
    return;
  }
  for (const capture of browserCaptures.values()) {
    if (capture.stopping || capture.finished) continue;
    capture.stopping = true;
    capture.processor.onaudioprocess = null;
    for (const track of capture.stream.getTracks()) track.stop();
    if (capture.samples.length >= TARGET_RATE / 2) {
      capture.queue.push({ samples: Float32Array.from(capture.samples), start: capture.chunkIndex * STEP_SAMPLES / TARGET_RATE });
    }
    capture.samples = [];
    pumpBrowserCapture(capture);
  }
}
