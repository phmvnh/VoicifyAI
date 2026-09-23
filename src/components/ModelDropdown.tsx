import { CheckCircle2, ChevronDown, CloudDownload, LoaderCircle, Trash2, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ModelStatus } from "../types";

interface ModelDropdownProps {
  models: string[];
  statuses: ModelStatus[];
  selectedModel: string;
  disabled: boolean;
  taskRunning: boolean;
  onSelect: (model: string) => void;
  onDownload: (model: string) => void;
  onCancelDownload: (model: string) => void;
  onRemove: (model: string) => void;
}

const fallbackLabels: Record<string, [string, string]> = {
  small: ["Whisper Small", "Nhẹ"],
  medium: ["Whisper Medium", "Cân bằng"],
  turbo: ["Whisper Turbo", "Khuyên dùng"],
  "large-v3": ["Whisper Large v3", "Chính xác"],
};

export function formatModelBytes(bytes: number) {
  if (bytes <= 0) return "—";
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function fallbackStatus(model: string): ModelStatus {
  const [label, description] = fallbackLabels[model] ?? [model, ""];
  return {
    id: model,
    label,
    description,
    downloaded: false,
    downloading: false,
    cancel_requested: false,
    removing: false,
    size_bytes: 0,
    total_bytes: null,
    error: null,
    error_operation: null,
  };
}

function progressOf(status: ModelStatus) {
  return status.total_bytes
    ? Math.min(100, Math.round((status.size_bytes / status.total_bytes) * 100))
    : null;
}

export function ModelDropdown({ models, statuses, selectedModel, disabled, taskRunning, onSelect, onDownload, onCancelDownload, onRemove }: ModelDropdownProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const entries = useMemo(() => models.map((model) => statuses.find((status) => status.id === model) ?? fallbackStatus(model)), [models, statuses]);
  const downloaded = entries.filter((status) => status.downloaded || status.removing);
  const missing = entries.filter((status) => !status.downloaded && !status.removing);
  const ordered = [...downloaded, ...missing];
  const selected = entries.find((status) => status.id === selectedModel) ?? fallbackStatus(selectedModel);
  const activeDownload = entries.find((status) => status.downloading);
  const triggerProgress = activeDownload ? progressOf(activeDownload) : null;

  useEffect(() => {
    const selectedIndex = ordered.findIndex((status) => status.id === selectedModel);
    if (selectedIndex >= 0) setActiveIndex(selectedIndex);
  }, [open, selectedModel, ordered.map((status) => status.id).join("|")]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    window.requestAnimationFrame(() => listRef.current?.focus());
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  const moveActive = (direction: number) => {
    if (!ordered.length) return;
    setActiveIndex((current) => (current + direction + ordered.length) % ordered.length);
  };

  const chooseActive = () => {
    const status = ordered[activeIndex];
    if (!status || status.removing) return;
    onSelect(status.id);
    setOpen(false);
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      moveActive(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((current) => !current);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      chooseActive();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  const renderRow = (status: ModelStatus) => {
    const progress = progressOf(status);
    const selectedRow = status.id === selectedModel;
    const removeDisabled = selectedRow || taskRunning || status.removing;
    const removeReason = selectedRow
      ? "Không thể gỡ model đang được chọn"
      : taskRunning
        ? "Không thể gỡ model khi tác vụ nhận diện đang chạy"
        : undefined;
    const sizeLabel = status.downloading && status.total_bytes
      ? `${formatModelBytes(status.size_bytes)} / ${formatModelBytes(status.total_bytes)}`
      : formatModelBytes(status.size_bytes || status.total_bytes || 0);
    return (
      <div
        key={status.id}
        id={`${listboxId}-${status.id}`}
        className={`model-option ${selectedRow ? "selected" : ""} ${ordered[activeIndex]?.id === status.id ? "active" : ""} ${!status.downloaded ? "not-downloaded" : ""} ${status.removing ? "locked" : ""}`}
        role="option"
        aria-selected={selectedRow}
        aria-disabled={status.removing}
        onMouseEnter={() => setActiveIndex(ordered.findIndex((item) => item.id === status.id))}
        onMouseDown={(event) => {
          if (!(event.target as HTMLElement).closest("button")) event.preventDefault();
        }}
        onClick={() => {
          if (!status.removing) {
            onSelect(status.id);
            setOpen(false);
          }
        }}
      >
        <span className="model-option-name"><strong>{status.label}</strong><small>{status.description}{sizeLabel !== "—" ? ` · ${sizeLabel}` : ""}</small></span>
        <span className="model-option-action" onClick={(event) => event.stopPropagation()}>
          {status.removing ? <><LoaderCircle className="spin" size={14} /><small>Đang gỡ</small></> : status.downloading ? <>
            <small>{status.cancel_requested ? "Đang huỷ…" : progress === null ? "Đang tải" : `${progress}%`}</small>
            <button type="button" disabled={status.cancel_requested} onClick={() => onCancelDownload(status.id)} aria-label={`Huỷ tải ${status.label}`} title="Huỷ tải"><X size={13} /></button>
          </> : status.downloaded ? <>
            <CheckCircle2 className="model-installed-check" size={15} />
            <span className="model-action-tooltip" title={removeReason ?? `Gỡ ${status.label}`}>
              <button type="button" className="model-row-action danger icon-only" disabled={removeDisabled} onClick={() => onRemove(status.id)} aria-label={`Gỡ ${status.label} khỏi thiết bị`}><Trash2 size={13} /></button>
            </span>
          </> : <>
            <small className="model-missing-label">Chưa tải</small>
            <button type="button" className="model-row-action" onClick={() => onDownload(status.id)} aria-label={`Tải ${status.label}`}><CloudDownload size={13} /><span>Tải</span></button>
          </>}
        </span>
        {status.downloading && <span className={`model-row-progress ${progress === null ? "indeterminate" : ""}`}><i style={progress === null ? undefined : { width: `${progress}%` }} /></span>}
      </div>
    );
  };

  return (
    <div className="model-picker" ref={rootRef}>
      <span className="model-picker-label">Model</span>
      <button
        type="button"
        className={`model-picker-trigger ${open ? "open" : ""} ${activeDownload ? "has-progress" : ""}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span><strong>{selected.label}</strong><small>{selected.description}</small></span>
        <ChevronDown size={15} />
        {activeDownload && <span className={`model-trigger-progress ${triggerProgress === null ? "indeterminate" : ""}`}><i style={triggerProgress === null ? undefined : { width: `${triggerProgress}%` }} /></span>}
      </button>
      {open && (
        <div
          ref={listRef}
          id={listboxId}
          className="model-listbox"
          role="listbox"
          tabIndex={0}
          aria-label="Chọn và quản lý model nhận diện"
          aria-activedescendant={ordered[activeIndex] ? `${listboxId}-${ordered[activeIndex].id}` : undefined}
          onKeyDown={handleListKeyDown}
          onBlur={(event) => {
            if (!rootRef.current?.contains(event.relatedTarget as Node)) setOpen(false);
          }}
        >
          {downloaded.length > 0 && <><div className="model-group-title">Đã có trên máy</div>{downloaded.map(renderRow)}</>}
          {missing.length > 0 && <><div className="model-group-title">Cần tải xuống</div>{missing.map(renderRow)}</>}
        </div>
      )}
    </div>
  );
}
