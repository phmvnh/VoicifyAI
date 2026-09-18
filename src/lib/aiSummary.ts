import { invoke } from "@tauri-apps/api/core";
import type { AiProvider, AiSummaryConfigStatus, AiSummaryOutput, SaveAiSummaryConfigInput, SummaryMode } from "../types";

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

export const getAiSummaryStatus = () => invoke<AiSummaryConfigStatus>("ai_summary_status");
export const saveAiSummaryConfig = (input: SaveAiSummaryConfigInput) => invoke<AiSummaryConfigStatus>("save_ai_summary_config", { input });
export const clearAiSummaryConfig = () => invoke<AiSummaryConfigStatus>("clear_ai_summary_config");
export const generateAiSummary = (transcript: string, mode: SummaryMode, customInstruction: string) => invoke<AiSummaryOutput>("generate_ai_summary", { input: { transcript, mode, customInstruction: customInstruction || null } });
export const providerLabel = (provider: AiProvider) => AI_PROVIDERS.find((item) => item.id === provider)?.label ?? provider;
