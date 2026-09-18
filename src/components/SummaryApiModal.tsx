import { X } from "lucide-react";
import { useEffect } from "react";
import type { AiSummaryConfigStatus, SaveAiSummaryConfigInput } from "../types";
import { SummaryApiConfig } from "./SummaryApiConfig";

interface SummaryApiModalProps {
  status: AiSummaryConfigStatus;
  onClose: () => void;
  onSave: (input: SaveAiSummaryConfigInput) => Promise<AiSummaryConfigStatus>;
  onClear: () => Promise<void>;
}

export function SummaryApiModal({ status, onClose, onSave, onClear }: SummaryApiModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="summary-api-modal" role="dialog" aria-modal="true" aria-labelledby="summary-api-modal-title">
        <header><div><h2 id="summary-api-modal-title">Cấu hình AI Summary</h2><p>Chọn dịch vụ và model dùng để tóm tắt nội dung.</p></div><button type="button" onClick={onClose} aria-label="Đóng cấu hình AI Summary"><X size={18} /></button></header>
        <div className="summary-api-modal-content"><SummaryApiConfig status={status} showHeading={false} onSave={onSave} onClear={onClear} /><p className="summary-preview-note">API key được lưu an toàn trên thiết bị và chỉ dùng khi bạn yêu cầu tạo bản tóm tắt.</p></div>
      </div>
    </div>
  );
}
