import { Eye, EyeOff, KeyRound, LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AI_PROVIDERS } from "../lib/aiSummary";
import type { AiProvider, AiSummaryConfigStatus, SaveAiSummaryConfigInput } from "../types";
import { isTauriRuntime } from "../lib/runtime";

interface SummaryApiConfigProps {
  status: AiSummaryConfigStatus;
  showHeading?: boolean;
  onSave: (input: SaveAiSummaryConfigInput) => Promise<AiSummaryConfigStatus>;
  onClear: () => Promise<void>;
}

export function SummaryApiConfig({ status, showHeading = true, onSave, onClear }: SummaryApiConfigProps) {
  const [provider, setProvider] = useState<AiProvider>(status.provider);
  const [model, setModel] = useState(status.model);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setProvider(status.provider);
    setModel(status.model);
    setApiKey("");
  }, [status]);

  const providerOption = AI_PROVIDERS.find((item) => item.id === provider) ?? AI_PROVIDERS[0];
  const existingKeyCanBeReused = status.configuredProviders.includes(provider);
  const canSave = Boolean(apiKey.trim()) || existingKeyCanBeReused;

  const selectProvider = (nextProvider: AiProvider) => {
    const next = AI_PROVIDERS.find((item) => item.id === nextProvider) ?? AI_PROVIDERS[0];
    setProvider(nextProvider);
    setModel(next.models[0].id);
    setApiKey("");
    setError(null);
    setSuccess(false);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const saved = await onSave({ provider, model, apiKey });
      if (!saved.configured || saved.provider !== provider || saved.model !== model) {
        throw new Error(saved.storageError ?? "Cấu hình AI chưa được đồng bộ. Hãy thử lại.");
      }
      setApiKey("");
      setSuccess(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      await onClear();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="summary-api-config">
      {showHeading && (
        <div className="summary-api-heading">
          <div><h3>AI Summary</h3><p className="settings-description">Kết nối mô hình AI để tạo bản tóm tắt sau cuộc họp.</p></div>
          <span className={status.configured ? "configured" : ""}>{status.configured ? "Đã cấu hình" : "Chưa cấu hình"}</span>
        </div>
      )}
      <div className="summary-api-card">
        <fieldset disabled={busy}>
          <legend>Chọn nguồn</legend>
          <div className="provider-picker">
            {AI_PROVIDERS.map((item) => (
              <button key={item.id} type="button" className={provider === item.id ? "active" : ""} aria-pressed={provider === item.id} onClick={() => selectProvider(item.id)}>
                <span className="provider-logo">{item.label.charAt(0)}</span>{item.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="summary-api-fields">
          <label>Model<select value={model} disabled={busy} onChange={(event) => { setModel(event.target.value); setSuccess(false); }}>{providerOption.models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>API key<span className="api-key-input"><KeyRound size={14} /><input type={showApiKey ? "text" : "password"} value={apiKey} disabled={busy} placeholder={existingKeyCanBeReused ? "Đã lưu trong Credential Manager" : providerOption.keyPlaceholder} autoComplete="off" spellCheck={false} onChange={(event) => { setApiKey(event.target.value); setSuccess(false); }} /><button type="button" aria-label={showApiKey ? "Ẩn API key" : "Hiện API key"} onClick={() => setShowApiKey((current) => !current)}>{showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></span></label>
        </div>
        {(error || status.storageError) && <p className="summary-config-error" role="alert">{error ?? status.storageError}</p>}
        {success && <p className="summary-config-success" role="status">Kết nối thành công với {providerOption.label} · {model}</p>}
        <div className="summary-api-footer">
          <p>{isTauriRuntime() ? "API key được lưu trong trình quản lý thông tin đăng nhập của hệ điều hành." : "API key chỉ được giữ trong phiên làm việc của tab trình duyệt."}</p>
          <div>
            {(status.configured || status.storageError) && <button type="button" className="clear-ai-config" disabled={busy} onClick={clear} aria-label="Xóa cấu hình AI"><Trash2 size={13} /></button>}
            <button type="button" disabled={busy || !canSave} onClick={save}>{busy && <LoaderCircle className="spin" size={13} />}{busy ? "Đang kết nối…" : "Kết nối"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
