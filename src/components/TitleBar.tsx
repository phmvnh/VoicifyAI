import { AudioLines, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

async function runWindowAction(action: "minimize" | "maximize" | "close") {
  try {
    const window = getCurrentWindow();
    if (action === "maximize") await window.toggleMaximize();
    else await window[action]();
  } catch {
    // Vite browser preview has no Tauri window; controls become active in the desktop shell.
  }
}

export function TitleBar() {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <span className="app-mark"><AudioLines size={15} /></span>
        <span>VoicifyAI</span>
      </div>
      <div className="window-actions" aria-label="Điều khiển cửa sổ">
        <button type="button" aria-label="Thu nhỏ" onClick={() => void runWindowAction("minimize")}><Minus size={15} /></button>
        <button type="button" aria-label="Phóng to" onClick={() => void runWindowAction("maximize")}><Square size={12} /></button>
        <button type="button" className="close" aria-label="Đóng" onClick={() => void runWindowAction("close")}><X size={15} /></button>
      </div>
    </header>
  );
}
