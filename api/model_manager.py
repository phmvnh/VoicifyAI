"""Download, cancellation, removal, and cache inspection for curated Whisper models."""

from __future__ import annotations

import fnmatch
import shutil
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from huggingface_hub import HfApi, constants, snapshot_download, try_to_load_from_cache
from tqdm.auto import tqdm


MODEL_CATALOG: dict[str, dict[str, str]] = {
    "tiny": {"label": "Whisper Tiny", "description": "Nhanh nhất", "repo_id": "Systran/faster-whisper-tiny"},
    "base": {"label": "Whisper Base", "description": "Gọn nhẹ", "repo_id": "Systran/faster-whisper-base"},
    "small": {"label": "Whisper Small", "description": "Nhẹ", "repo_id": "Systran/faster-whisper-small"},
    "medium": {"label": "Whisper Medium", "description": "Cân bằng", "repo_id": "Systran/faster-whisper-medium"},
    "turbo": {"label": "Whisper Turbo", "description": "Khuyên dùng", "repo_id": "mobiuslabsgmbh/faster-whisper-large-v3-turbo"},
    "large-v3": {"label": "Whisper Large v3", "description": "Chính xác", "repo_id": "Systran/faster-whisper-large-v3"},
}

DOWNLOAD_PATTERNS = ("config.json", "preprocessor_config.json", "model.bin", "tokenizer.json", "vocabulary.*")


class ModelOperationConflict(RuntimeError):
    """Raised when a model operation conflicts with another active operation."""


class ModelDownloadCancelled(RuntimeError):
    """Internal signal used to interrupt Hugging Face downloads."""


@dataclass
class ModelOperationState:
    downloading: bool = False
    cancel_requested: bool = False
    removing: bool = False
    downloaded_bytes: int = 0
    total_bytes: int | None = None
    error: str | None = None
    error_operation: str | None = None


def _cancelable_tqdm(cancel_event: threading.Event) -> type[tqdm]:
    class CancelableTqdm(tqdm):
        def update(self, n: int | float = 1) -> bool | None:
            if cancel_event.is_set():
                raise ModelDownloadCancelled("Đã huỷ tải model")
            return super().update(n)

    return CancelableTqdm


class ModelDownloadManager:
    def __init__(self) -> None:
        self._states = {model: ModelOperationState() for model in MODEL_CATALOG}
        self._cancel_events = {model: threading.Event() for model in MODEL_CATALOG}
        self._lock = threading.RLock()

    def list_statuses(self) -> list[dict[str, Any]]:
        return [self.status(model) for model in MODEL_CATALOG]

    def status(self, model: str) -> dict[str, Any]:
        metadata = self._metadata(model)
        cached_path = self._cached_model_path(metadata["repo_id"])
        with self._lock:
            state = self._states[model]
            if state.downloading:
                state.downloaded_bytes = self._cache_size(metadata["repo_id"])
            downloaded = cached_path is not None
            size_bytes = self._snapshot_size(cached_path) if cached_path else state.downloaded_bytes
            return {
                "id": model,
                "label": metadata["label"],
                "description": metadata["description"],
                "downloaded": downloaded,
                "downloading": state.downloading,
                "cancel_requested": state.cancel_requested,
                "removing": state.removing,
                "size_bytes": size_bytes,
                "total_bytes": state.total_bytes,
                "error": state.error,
                "error_operation": state.error_operation,
            }

    def start_download(self, model: str) -> dict[str, Any]:
        metadata = self._metadata(model)
        if self._cached_model_path(metadata["repo_id"]) is not None:
            return self.status(model)
        with self._lock:
            state = self._states[model]
            if state.removing:
                raise ModelOperationConflict("Model đang được gỡ khỏi thiết bị")
            if state.downloading:
                return self.status(model)
            cancel_event = self._cancel_events[model]
            cancel_event.clear()
            state.downloading = True
            state.cancel_requested = False
            state.downloaded_bytes = self._cache_size(metadata["repo_id"])
            state.total_bytes = None
            state.error = None
            state.error_operation = None
        threading.Thread(target=self._download, args=(model, metadata["repo_id"], cancel_event), name=f"download-{model}", daemon=True).start()
        return self.status(model)

    def cancel_download(self, model: str) -> dict[str, Any]:
        self._metadata(model)
        with self._lock:
            state = self._states[model]
            if state.downloading:
                state.cancel_requested = True
                self._cancel_events[model].set()
        return self.status(model)

    def start_remove(self, model: str) -> dict[str, Any]:
        metadata = self._metadata(model)
        with self._lock:
            state = self._states[model]
            if state.downloading:
                raise ModelOperationConflict("Hãy huỷ tải trước khi gỡ model")
            if state.removing:
                return self.status(model)
            if self._cached_model_path(metadata["repo_id"]) is None:
                state.downloaded_bytes = 0
                return self.status(model)
            state.removing = True
            state.error = None
            state.error_operation = None
        threading.Thread(target=self._remove, args=(model, metadata["repo_id"]), name=f"remove-{model}", daemon=True).start()
        return self.status(model)

    def _download(self, model: str, repo_id: str, cancel_event: threading.Event) -> None:
        cancelled = False
        try:
            total_bytes = self._remote_size(repo_id)
            with self._lock:
                self._states[model].total_bytes = total_bytes
            if cancel_event.is_set():
                raise ModelDownloadCancelled("Đã huỷ tải model")
            snapshot_download(repo_id, allow_patterns=list(DOWNLOAD_PATTERNS), tqdm_class=_cancelable_tqdm(cancel_event))
            if cancel_event.is_set():
                raise ModelDownloadCancelled("Đã huỷ tải model")
        except ModelDownloadCancelled:
            cancelled = True
            self._remove_cache(repo_id)
        except Exception as exc:
            with self._lock:
                state = self._states[model]
                state.error = str(exc)
                state.error_operation = "download"
        finally:
            with self._lock:
                state = self._states[model]
                state.downloading = False
                state.cancel_requested = False
                state.downloaded_bytes = 0 if cancelled else self._cache_size(repo_id)

    def _remove(self, model: str, repo_id: str) -> None:
        try:
            self._remove_cache(repo_id)
        except Exception as exc:
            with self._lock:
                state = self._states[model]
                state.error = str(exc)
                state.error_operation = "remove"
        finally:
            with self._lock:
                state = self._states[model]
                state.removing = False
                state.downloaded_bytes = self._cache_size(repo_id)

    @staticmethod
    def _metadata(model: str) -> dict[str, str]:
        try:
            return MODEL_CATALOG[model]
        except KeyError as exc:
            raise ValueError(f"Model '{model}' không nằm trong danh sách giao diện") from exc

    @staticmethod
    def _repo_cache_path(repo_id: str) -> Path:
        cache_root = Path(constants.HF_HUB_CACHE).resolve()
        repo_path = (cache_root / f"models--{repo_id.replace('/', '--')}").resolve()
        if repo_path.parent != cache_root:
            raise RuntimeError("Đường dẫn cache model không hợp lệ")
        return repo_path

    @classmethod
    def _remove_cache(cls, repo_id: str) -> None:
        repo_path = cls._repo_cache_path(repo_id)
        if repo_path.is_dir():
            shutil.rmtree(repo_path)

    @staticmethod
    def _cached_model_path(repo_id: str) -> Path | None:
        cached = try_to_load_from_cache(repo_id, "model.bin")
        if isinstance(cached, str):
            path = Path(cached)
            if path.is_file() and path.stat().st_size > 0:
                return path.parent
        return None

    @staticmethod
    def _snapshot_size(snapshot: Path) -> int:
        return sum(path.stat().st_size for path in snapshot.iterdir() if path.is_file())

    @classmethod
    def _cache_size(cls, repo_id: str) -> int:
        blobs = cls._repo_cache_path(repo_id) / "blobs"
        if not blobs.is_dir():
            return 0
        return sum(path.stat().st_size for path in blobs.iterdir() if path.is_file())

    @staticmethod
    def _remote_size(repo_id: str) -> int | None:
        try:
            info = HfApi().model_info(repo_id, files_metadata=True)
        except Exception:
            return None
        return sum(sibling.size or 0 for sibling in info.siblings if any(fnmatch.fnmatch(sibling.rfilename, pattern) for pattern in DOWNLOAD_PATTERNS)) or None


model_downloads = ModelDownloadManager()
