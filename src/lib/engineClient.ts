import type { EngineConfig, TranscriptionResult } from "../types";

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

export async function fetchLanguages(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/v1/languages`);
  if (!response.ok) throw new Error(await readError(response));
  const body = (await response.json()) as { languages: string[] };
  return body.languages;
}
