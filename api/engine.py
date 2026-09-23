"""Lifecycle and inference wrapper around :mod:`faster_whisper`.

This module deliberately keeps model loading lazy: importing the FastAPI app does not
download a model or allocate GPU memory.  The first transcription request (or this
module's CLI) loads the requested model.
"""

from __future__ import annotations

import argparse
import json
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, BinaryIO, Optional, Union

from faster_whisper import WhisperModel


AudioInput = Union[str, BinaryIO]


@dataclass(frozen=True)
class ModelConfig:
    model: str = "tiny"
    device: str = "auto"
    compute_type: str = "default"
    device_index: int = 0
    cpu_threads: int = 0
    num_workers: int = 1
    download_root: Optional[str] = None
    local_files_only: bool = False


class EngineError(RuntimeError):
    """Raised when the speech engine cannot load or transcribe."""


class TranscriptionEngine:
    """Owns one Whisper model and serializes access while it is being replaced."""

    def __init__(self) -> None:
        self._model: Optional[WhisperModel] = None
        self._config: Optional[ModelConfig] = None
        self._lock = threading.RLock()
        self._activity_lock = threading.Lock()
        self._active_requests = 0

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    @property
    def config(self) -> Optional[ModelConfig]:
        return self._config

    @property
    def is_busy(self) -> bool:
        with self._activity_lock:
            return self._active_requests > 0

    def status(self) -> dict[str, Any]:
        config = asdict(self._config) if self._config else None
        return {"model_loaded": self.is_loaded, "model_config": config, "busy": self.is_busy}

    def unload(self, model: str | None = None) -> None:
        """Release an idle model before its cached files are removed."""
        with self._lock:
            if model is None or (self._config is not None and self._config.model == model):
                self._model = None
                self._config = None

    def load(self, config: ModelConfig) -> WhisperModel:
        with self._lock:
            if self._model is not None and self._config == config:
                return self._model

            try:
                model = WhisperModel(
                    config.model,
                    device=config.device,
                    device_index=config.device_index,
                    compute_type=config.compute_type,
                    cpu_threads=config.cpu_threads,
                    num_workers=config.num_workers,
                    download_root=config.download_root,
                    local_files_only=config.local_files_only,
                )
            except Exception as exc:
                raise EngineError(f"Không thể tải model '{config.model}': {exc}") from exc

            self._model = model
            self._config = config
            return model

    def transcribe(
        self,
        audio: AudioInput,
        *,
        model_config: ModelConfig,
        language: Optional[str] = None,
        task: str = "transcribe",
        vad_filter: bool = True,
        word_timestamps: bool = True,
        condition_on_previous_text: bool = True,
        hallucination_silence_threshold: Optional[float] = None,
        initial_prompt: Optional[str] = None,
        hotwords: Optional[str] = None,
    ) -> dict[str, Any]:
        if task not in {"transcribe", "translate"}:
            raise EngineError("task phải là 'transcribe' hoặc 'translate'")

        with self._activity_lock:
            self._active_requests += 1
        try:
            with self._lock:
                model = self.load(model_config)
                started_at = time.perf_counter()
                try:
                    segment_iterator, info = model.transcribe(
                        audio,
                        language=language,
                        task=task,
                        vad_filter=vad_filter,
                        word_timestamps=word_timestamps,
                        condition_on_previous_text=condition_on_previous_text,
                        hallucination_silence_threshold=hallucination_silence_threshold,
                        initial_prompt=initial_prompt,
                        hotwords=hotwords,
                    )
                    segments = []
                    for segment in segment_iterator:
                        words = None
                        if segment.words is not None:
                            words = [
                                {
                                    "start": word.start,
                                    "end": word.end,
                                    "word": word.word,
                                    "probability": word.probability,
                                }
                                for word in segment.words
                            ]
                        segments.append(
                            {
                                "id": segment.id,
                                "start": segment.start,
                                "end": segment.end,
                                "text": segment.text,
                                "words": words,
                                "avg_logprob": segment.avg_logprob,
                                "no_speech_prob": segment.no_speech_prob,
                                "compression_ratio": segment.compression_ratio,
                            }
                        )
                except Exception as exc:
                    raise EngineError(f"Nhận diện âm thanh thất bại: {exc}") from exc
        finally:
            with self._activity_lock:
                self._active_requests -= 1

        elapsed = time.perf_counter() - started_at
        duration = float(info.duration)
        return {
            "text": "".join(segment["text"] for segment in segments).strip(),
            "segments": segments,
            "language": info.language,
            "language_probability": info.language_probability,
            "duration": duration,
            "duration_after_vad": float(info.duration_after_vad),
            "inference_seconds": elapsed,
            "rtf": elapsed / duration if duration > 0 else 0.0,
        }


engine = TranscriptionEngine()


def _main() -> int:
    parser = argparse.ArgumentParser(description="Chạy thử VoicifyAI transcription engine")
    parser.add_argument("audio", type=Path, help="Đường dẫn file âm thanh")
    parser.add_argument("--model", default="tiny", help="Tên model hoặc đường dẫn local")
    parser.add_argument("--device", default="auto", choices=("auto", "cpu", "cuda"))
    parser.add_argument("--compute-type", default="default")
    parser.add_argument("--language", default=None)
    parser.add_argument("--task", default="transcribe", choices=("transcribe", "translate"))
    parser.add_argument("--local-files-only", action="store_true")
    args = parser.parse_args()

    if not args.audio.is_file():
        parser.error(f"Không tìm thấy file: {args.audio}")

    result = engine.transcribe(
        str(args.audio),
        model_config=ModelConfig(
            model=args.model,
            device=args.device,
            compute_type=args.compute_type,
            local_files_only=args.local_files_only,
        ),
        language=args.language,
        task=args.task,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
