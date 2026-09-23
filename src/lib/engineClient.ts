import type { EngineConfig, GpuRuntimeStatus, HardwareStatus, ModelStatus, TranscriptionResult } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8765";

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail ?? `API trả về mã ${response.status}`;
  } catch {
    return `Không thể kết nối API (mã ${response.status})`;
  }
}

export async function transcribeFile(
  file: File,
  config: EngineConfig,
): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append("audio", file);
  form.append("config", JSON.stringify(config));
  const response = await fetch(`${API_BASE}/v1/transcribe/batch`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<TranscriptionResult>;
}

export async function fetchModels(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/v1/models`);
  if (!response.ok) throw new Error(await readError(response));
  const body = (await response.json()) as { models: string[] };
  return body.models;
}

export async function fetchModelStatuses(): Promise<ModelStatus[]> {
  const response = await fetch(`${API_BASE}/v1/models/status`);
  if (!response.ok) throw new Error(await readError(response));
  const body = (await response.json()) as { models: ModelStatus[] };
  return body.models;
}

export async function downloadModel(model: string): Promise<ModelStatus> {
  const response = await fetch(`${API_BASE}/v1/models/${encodeURIComponent(model)}/download`, {
    method: "POST",
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<ModelStatus>;
}

export async function cancelModelDownload(model: string): Promise<ModelStatus> {
  const response = await fetch(`${API_BASE}/v1/models/${encodeURIComponent(model)}/download`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<ModelStatus>;
}

export async function removeModel(model: string): Promise<ModelStatus> {
  const response = await fetch(`${API_BASE}/v1/models/${encodeURIComponent(model)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<ModelStatus>;
}

export async function fetchLanguages(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/v1/languages`);
  if (!response.ok) throw new Error(await readError(response));
  const body = (await response.json()) as { languages: string[] };
  return body.languages;
}

export async function fetchHardwareStatus(): Promise<HardwareStatus> {
  const response = await fetch(`${API_BASE}/v1/hardware`);
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<HardwareStatus>;
}

export async function fetchGpuRuntimeStatus(): Promise<GpuRuntimeStatus> {
  const response = await fetch(`${API_BASE}/v1/runtime/gpu/status`);
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<GpuRuntimeStatus>;
}

export async function installGpuRuntime(): Promise<GpuRuntimeStatus> {
  const response = await fetch(`${API_BASE}/v1/runtime/gpu/install`, { method: "POST" });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<GpuRuntimeStatus>;
}

export async function cancelGpuRuntimeInstall(): Promise<GpuRuntimeStatus> {
  const response = await fetch(`${API_BASE}/v1/runtime/gpu/install`, { method: "DELETE" });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<GpuRuntimeStatus>;
}

export async function removeGpuRuntime(): Promise<GpuRuntimeStatus> {
  const response = await fetch(`${API_BASE}/v1/runtime/gpu`, { method: "DELETE" });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<GpuRuntimeStatus>;
}
