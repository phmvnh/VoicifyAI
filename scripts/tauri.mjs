import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const cargoBin = join(homedir(), ".cargo", "bin");
const tauriCli = join(
  process.cwd(),
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js",
);
const currentPath = process.env.PATH ?? process.env.Path ?? "";

const child = spawn(process.execPath, [tauriCli, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PATH: `${cargoBin}${delimiter}${currentPath}`,
  },
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Không thể khởi chạy Tauri CLI: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
