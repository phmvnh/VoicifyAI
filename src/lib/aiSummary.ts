import type { AiProvider, AiSummaryConfigStatus, AiSummaryOutput, SaveAiSummaryConfigInput, SummaryMode } from "../types";
import { isTauriRuntime, webApiBase } from "./runtime";

export interface AiProviderOption {
  id: AiProvider;
  label: string;
  keyPlaceholder: string;
  models: { id: string; label: string }[];
}

export const AI_PROVIDERS: AiProviderOption[] = [
  {
    id: "gemini", label: "Gemini", keyPlaceholder: "AIza...",
    models: [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
      { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
      { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Preview)" },
      { id: "gemini-flash-latest", label: "Gemini Flash (Latest)" },
    ],
  },
  { id: "grok", label: "Grok", keyPlaceholder: "xai-...", models: [
    { id: "grok-4.6", label: "Grok 4.6" }, { id: "grok-4.3", label: "Grok 4.3" },
  ] },
  { id: "openai", label: "OpenAI", keyPlaceholder: "sk-...", models: [
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" }, { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" }, { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  ] },
  { id: "anthropic", label: "Anthropic", keyPlaceholder: "sk-ant-...", models: [
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" }, { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" }, { id: "claude-opus-4-8", label: "Claude Opus 4.8" }, { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  ] },
];

export const DEFAULT_AI_CONFIG: AiSummaryConfigStatus = { provider: "gemini", model: AI_PROVIDERS[0].models[0].id, configured: false, configuredProviders: [], storageError: null };

const WEB_AI_KEY = "voicifyai-web-ai-config-v1";

interface WebAiConfig {
  provider: AiProvider;
  model: string;
  keys: Partial<Record<AiProvider, string>>;
}

function readWebConfig(): WebAiConfig | null {
  try {
    return JSON.parse(sessionStorage.getItem(WEB_AI_KEY) ?? "null") as WebAiConfig | null;
  } catch {
    return null;
  }
}

function webStatus(): AiSummaryConfigStatus {
  const stored = readWebConfig();
  if (!stored) return DEFAULT_AI_CONFIG;
  const configuredProviders = Object.entries(stored.keys)
    .filter(([, key]) => Boolean(key))
    .map(([provider]) => provider as AiProvider);
  return {
    provider: stored.provider,
    model: stored.model,
    configured: Boolean(stored.keys[stored.provider]),
    configuredProviders,
    storageError: null,
  };
}

async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export async function getAiSummaryStatus(): Promise<AiSummaryConfigStatus> {
  return isTauriRuntime() ? tauriInvoke<AiSummaryConfigStatus>("ai_summary_status") : webStatus();
}

export async function saveAiSummaryConfig(input: SaveAiSummaryConfigInput): Promise<AiSummaryConfigStatus> {
  if (isTauriRuntime()) return tauriInvoke<AiSummaryConfigStatus>("save_ai_summary_config", { input });
  const current = readWebConfig();
  const apiKey = input.apiKey.trim() || current?.keys[input.provider];
  if (!apiKey) throw new Error("Hãy nhập API key cho nhà cung cấp đã chọn.");
  sessionStorage.setItem(WEB_AI_KEY, JSON.stringify({
    provider: input.provider,
    model: input.model,
    keys: { ...(current?.keys ?? {}), [input.provider]: apiKey },
  } satisfies WebAiConfig));
  return webStatus();
}

export async function clearAiSummaryConfig(): Promise<AiSummaryConfigStatus> {
  if (isTauriRuntime()) return tauriInvoke<AiSummaryConfigStatus>("clear_ai_summary_config");
  sessionStorage.removeItem(WEB_AI_KEY);
  return DEFAULT_AI_CONFIG;
}

export async function generateAiSummary(transcript: string, mode: SummaryMode, customInstruction: string): Promise<AiSummaryOutput> {
  if (isTauriRuntime()) {
    return tauriInvoke<AiSummaryOutput>("generate_ai_summary", { input: { transcript, mode, customInstruction: customInstruction || null } });
  }
  const config = readWebConfig();
  const apiKey = config?.keys[config.provider];
  if (!config || !apiKey) throw new Error("Chưa cấu hình dịch vụ AI Summary.");
  const response = await fetch(`${webApiBase()}/v1/ai/summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: config.provider,
      model: config.model,
      api_key: apiKey,
      transcript,
      mode,
      custom_instruction: customInstruction || null,
    }),
  });
  const body = await response.json().catch(() => null) as (AiSummaryOutput & { detail?: string }) | null;
  if (!response.ok) throw new Error(body?.detail ?? `API tóm tắt trả về mã ${response.status}.`);
  return body as AiSummaryOutput;
}
export const providerLabel = (provider: AiProvider) => AI_PROVIDERS.find((item) => item.id === provider)?.label ?? provider;
