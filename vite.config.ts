import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const keyPath = env.VOICIFY_HTTPS_KEY_FILE;
  const certPath = env.VOICIFY_HTTPS_CERT_FILE;
  if (Boolean(keyPath) !== Boolean(certPath)) {
    throw new Error("Phải khai báo cả VOICIFY_HTTPS_KEY_FILE và VOICIFY_HTTPS_CERT_FILE.");
  }
  const https = keyPath && certPath
    ? {
        key: readFileSync(resolve(keyPath)),
        cert: readFileSync(resolve(certPath)),
      }
    : undefined;

  return {
    plugins: [react()],
    clearScreen: false,
    server: {
      // host: "127.0.0.1", // Chỉ cho phép truy cập trên máy local.
      host: "0.0.0.0", // Cho phép các thiết bị trong mạng LAN truy cập.
      port: 1420,
      strictPort: true,
      https,
      proxy: {
        "/v1": {
          target: "http://127.0.0.1:8765",
          changeOrigin: true,
          ws: true,
        },
      },
      watch: {
        ignored: ["**/src-tauri/target/**"],
      },
    },
  };
});
