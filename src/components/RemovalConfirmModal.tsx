import { HardDrive, LoaderCircle, Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";

interface RemovalConfirmModalProps {
  title: string;
  itemName: string;
  size: string;
  description: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function RemovalConfirmModal({ title, itemName, size, description, busy, onClose, onConfirm }: RemovalConfirmModalProps) {
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButton.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  return (
    <div className="modal-backdrop removal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <div className="removal-modal" role="alertdialog" aria-modal="true" aria-labelledby="removal-modal-title" aria-describedby="removal-modal-description">
        <button type="button" className="removal-modal-close" onClick={onClose} disabled={busy} aria-label="Đóng hộp thoại"><X size={17} /></button>
        <span className="removal-modal-icon"><Trash2 size={21} /></span>
        <h2 id="removal-modal-title">{title}</h2>
        <p id="removal-modal-description">{description}</p>
        <div className="removal-summary">
          <span><HardDrive size={16} /></span>
          <span><strong>{itemName}</strong><small>Dung lượng được giải phóng</small></span>
          <strong>{size}</strong>
        </div>
        <p className="removal-note">Bạn có thể tải lại bất cứ lúc nào.</p>
        <div className="removal-actions">
          <button ref={cancelButton} type="button" className="secondary" onClick={onClose} disabled={busy}>Huỷ</button>
          <button type="button" className="danger" onClick={onConfirm} disabled={busy}>{busy ? <><LoaderCircle className="spin" size={15} /> Đang gỡ…</> : <><Trash2 size={15} /> Gỡ khỏi thiết bị</>}</button>
        </div>
      </div>
    </div>
  );
}
