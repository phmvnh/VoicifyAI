"""Manage the optional, app-local NVIDIA runtime used by VoicifyAI."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import threading
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any


CUDA_RUNTIME_VERSION = "12"
CUBLAS_PACKAGE = ("nvidia-cublas-cu12", "12.9.2.10")
CUDNN_PACKAGE = ("nvidia-cudnn-cu12", "9.26.0.51")
CUDA_PACKAGES = (CUBLAS_PACKAGE, CUDNN_PACKAGE)
ESTIMATED_DOWNLOAD_BYTES = 1_300_000_000
REQUIRED_DLLS = ("cublas64_12.dll", "cublasLt64_12.dll", "cudnn64_9.dll")
DOWNLOAD_CHUNK_BYTES = 1024 * 1024


class GpuRuntimeConflict(RuntimeError):
    pass


class GpuRuntimeManager:
    def __init__(self, root: Path | None = None) -> None:
        local_app_data = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        self.root = (root or local_app_data / "VoicifyAI" / "runtime" / "cuda12").resolve()
        self._lock = threading.RLock()
        self._installing = False
        self._removing = False
        self._cancel_requested = False
        self._progress = 0.0
        self._error: str | None = None

    def runtime_dirs(self) -> list[Path]:
        candidates = (
            self.root / "nvidia" / "cublas" / "bin",
            self.root / "nvidia" / "cudnn" / "bin",
        )
        return [path for path in candidates if path.is_dir()]

    def installed(self) -> bool:
        directories = self.runtime_dirs()
        return bool(directories) and all(
            any((directory / filename).is_file() for directory in directories)
            for filename in REQUIRED_DLLS
        )

    def _size_bytes(self) -> int:
        if not self.root.exists():
            return 0
        return sum(path.stat().st_size for path in self.root.rglob("*") if path.is_file())

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {
                "installed": self.installed(),
                "installing": self._installing,
                "cancel_requested": self._cancel_requested,
                "removing": self._removing,
                "progress": self._progress,
                "version": CUDA_RUNTIME_VERSION,
                "size_bytes": self._size_bytes(),
                "estimated_download_bytes": ESTIMATED_DOWNLOAD_BYTES,
                "error": self._error,
            }

    def start_install(self) -> dict[str, Any]:
        if os.name != "nt":
            raise GpuRuntimeConflict("Tính năng cài tăng tốc GPU hiện chỉ hỗ trợ Windows")
        with self._lock:
            if self._installing or self._removing:
                raise GpuRuntimeConflict("Một thao tác với runtime GPU đang chạy")
            if self.installed():
                return self.status()
            self._installing = True
            self._cancel_requested = False
            self._progress = 0.01
            self._error = None
            threading.Thread(target=self._install_worker, daemon=True, name="gpu-runtime-install").start()
            return self.status()

    def cancel_install(self) -> dict[str, Any]:
        with self._lock:
            if not self._installing:
                return self.status()
            self._cancel_requested = True
        return self.status()

    def start_remove(self) -> dict[str, Any]:
        with self._lock:
            if self._installing or self._removing:
                raise GpuRuntimeConflict("Một thao tác với runtime GPU đang chạy")
            if not self.root.exists():
                return self.status()
            self._removing = True
            self._error = None
            threading.Thread(target=self._remove_worker, daemon=True, name="gpu-runtime-remove").start()
            return self.status()

    def _staging_root(self) -> Path:
        return self.root.with_name(f"{self.root.name}.installing")

    def _safe_remove(self, target: Path) -> None:
        resolved = target.resolve()
        expected_parent = self.root.parent.resolve()
        if resolved.parent != expected_parent or resolved.name not in {self.root.name, self._staging_root().name}:
            raise RuntimeError("Từ chối xóa thư mục runtime ngoài phạm vi VoicifyAI")
        if resolved.exists():
            shutil.rmtree(resolved)

    def _install_worker(self) -> None:
        staging = self._staging_root()
        try:
            staging.parent.mkdir(parents=True, exist_ok=True)
            self._safe_remove(staging)
            staging.mkdir(parents=True)

            # A frozen PyInstaller executable has no external Python/pip. Resolve
            # the official Windows wheels through PyPI, verify their hashes, and
            # extract them directly into the app-local runtime directory.
            wheels = [self._resolve_windows_wheel(name, version) for name, version in CUDA_PACKAGES]
            total_bytes = sum(int(wheel["size"]) for wheel in wheels) or ESTIMATED_DOWNLOAD_BYTES
            completed_bytes = 0
            for wheel in wheels:
                self._raise_if_cancelled()
                wheel_path = staging / f".{wheel['filename']}"
                digest = hashlib.sha256()
                with urllib.request.urlopen(wheel["url"], timeout=60) as response, wheel_path.open("wb") as output:
                    while chunk := response.read(DOWNLOAD_CHUNK_BYTES):
                        self._raise_if_cancelled()
                        output.write(chunk)
                        digest.update(chunk)
                        completed_bytes += len(chunk)
                        with self._lock:
                            self._progress = min(0.95, 0.02 + (completed_bytes / total_bytes) * 0.93)
                if digest.hexdigest().lower() != wheel["sha256"].lower():
                    raise RuntimeError("Tệp tải xuống không vượt qua kiểm tra SHA-256")
                self._extract_wheel(wheel_path, staging)
                wheel_path.unlink(missing_ok=True)

            directories = [staging / "nvidia" / "cublas" / "bin", staging / "nvidia" / "cudnn" / "bin"]
            missing = [name for name in REQUIRED_DLLS if not any((directory / name).is_file() for directory in directories)]
            if missing:
                raise RuntimeError(f"Gói tải xuống thiếu: {', '.join(missing)}")
            self._safe_remove(self.root)
            staging.replace(self.root)
            with self._lock:
                self._progress = 1.0
        except InterruptedError:
            try:
                self._safe_remove(staging)
            except OSError:
                pass
        except Exception as exc:
            with self._lock:
                self._error = f"Không thể cài tăng tốc GPU: {self._friendly_install_error(exc)}"
            try:
                self._safe_remove(staging)
            except OSError:
                pass
        finally:
            with self._lock:
                self._installing = False
                self._cancel_requested = False

    def _raise_if_cancelled(self) -> None:
        with self._lock:
            if self._cancel_requested:
                raise InterruptedError("Đã huỷ cài đặt")

    @staticmethod
    def _resolve_windows_wheel(package: str, version: str) -> dict[str, Any]:
        metadata_url = f"https://pypi.org/pypi/{package}/{version}/json"
        with urllib.request.urlopen(metadata_url, timeout=30) as response:
            metadata = json.load(response)
        candidates = [
            item for item in metadata.get("urls", [])
            if item.get("packagetype") == "bdist_wheel"
            and item.get("filename", "").endswith("win_amd64.whl")
            and not item.get("yanked", False)
        ]
        if not candidates:
            raise RuntimeError(f"Không tìm thấy wheel Windows x64 cho {package} {version}")
        wheel = candidates[0]
        return {
            "filename": wheel["filename"],
            "url": wheel["url"],
            "size": wheel.get("size") or 0,
            "sha256": wheel["digests"]["sha256"],
        }

    @staticmethod
    def _extract_wheel(wheel_path: Path, destination: Path) -> None:
        destination = destination.resolve()
        with zipfile.ZipFile(wheel_path) as archive:
            for member in archive.infolist():
                target = (destination / member.filename).resolve()
                if destination not in target.parents and target != destination:
                    raise RuntimeError("Wheel NVIDIA chứa đường dẫn không an toàn")
            archive.extractall(destination)

    @staticmethod
    def _friendly_install_error(error: Exception) -> str:
        output = str(error)
        lowered = output.lower()
        if isinstance(error, InterruptedError):
            return output
        if "sha-256" in lowered or "hash" in lowered:
            return "Tệp tải xuống không vượt qua kiểm tra toàn vẹn. Hãy kiểm tra mạng và nhấn tải lại."
        if "không tìm thấy wheel" in lowered:
            return "Không tìm thấy gói NVIDIA tương thích với phiên bản Windows/Python hiện tại."
        if isinstance(error, (urllib.error.URLError, TimeoutError)) or any(
            marker in lowered for marker in ("connection", "timed out", "name resolution", "proxy")
        ):
            return "Không thể kết nối máy chủ tải NVIDIA. Hãy kiểm tra mạng hoặc proxy rồi thử lại."
        return output or "Không thể tải runtime NVIDIA"

    def _remove_worker(self) -> None:
        try:
            self._safe_remove(self.root)
        except Exception as exc:
            with self._lock:
                self._error = f"Không thể gỡ runtime GPU. Hãy đóng và mở lại app rồi thử lại: {exc}"
        finally:
            with self._lock:
                self._removing = False


gpu_runtime = GpuRuntimeManager()
