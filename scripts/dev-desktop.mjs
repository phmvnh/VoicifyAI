import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

if (existsSync(".env")) process.loadEnvFile(".env");

const children = [];
let stopping = false;

function start(command, args, label) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(`[${label}] Không thể khởi động: ${error.message}`);
    shutdown(1);
  });
  child.on("exit", (code) => {
    if (!stopping && code !== 0) {
      console.error(`[${label}] Đã dừng với mã ${code}`);
      shutdown(code ?? 1);
    }
  });
  return child;
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exitCode = code;
}

async function apiIsRunning() {
  try {
    const response = await fetch("http://127.0.0.1:8765/v1/health", {
      signal: AbortSignal.timeout(800),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function urlIsRunning(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
}

if (!(await apiIsRunning())) {
  const python = process.platform === "win32" ? "python.exe" : "python3";
  start(
    python,
    // Dùng "127.0.0.1" thay cho "0.0.0.0" nếu chỉ muốn chạy local.
    ["-m", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8765"],
    "FastAPI",
  );
} else {
  console.log("[FastAPI] Đang chạy sẵn tại http://127.0.0.1:8765");
}

if (!(await urlIsRunning("http://127.0.0.1:1420/"))) {
  start(process.execPath, [join("node_modules", "vite", "bin", "vite.js")], "Vite");
} else {
  console.log("[Vite] Đang chạy sẵn tại http://127.0.0.1:1420");
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("exit", () => {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
});

await new Promise(() => {});
