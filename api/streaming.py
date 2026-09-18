"""Stateful processing for rolling live-audio chunks."""

from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any, Literal, Optional

import numpy as np

from api.engine import ModelConfig, TranscriptionEngine


Source = Literal["mic", "system"]
MIN_AUDIO_RMS = 0.0015
MIN_WORD_PROBABILITY = 0.25
MAX_NO_SPEECH_PROBABILITY = 0.65
OVERLAP_TOLERANCE_SECONDS = 0.08


def _normalized_words(text: str) -> list[str]:
    return [word.casefold().strip(".,!?;:…\"'()[]{}") for word in text.strip().split()]


def remove_overlap(previous: str, current: str, max_words: int = 20) -> str:
    """Remove a repeated word prefix introduced by overlapping audio chunks."""
    previous_words = previous.strip().split()
    current_words = current.strip().split()
    limit = min(len(previous_words), len(current_words), max_words)
    for size in range(limit, 0, -1):
        left = _normalized_words(" ".join(previous_words[-size:]))
        right = _normalized_words(" ".join(current_words[:size]))
        if left == right:
            return " ".join(current_words[size:]).strip()
    for size in range(limit, 4, -1):
        left = _normalized_words(" ".join(previous_words[-size:]))
        right = _normalized_words(" ".join(current_words[:size]))
        if SequenceMatcher(None, left, right, autojunk=False).ratio() >= 0.86:
            return " ".join(current_words[size:]).strip()
    return current.strip()


def fresh_text_from_segments(segments: list[dict[str, Any]], overlap_seconds: float) -> tuple[str, float | None]:
    """Keep only words outside the audio already covered by the previous chunk."""
    kept_words: list[dict[str, Any]] = []
    threshold = max(0.0, overlap_seconds - OVERLAP_TOLERANCE_SECONDS)
    for segment in segments:
        for word in segment.get("words") or []:
            if float(word.get("end", 0.0)) > threshold:
                kept_words.append(word)
    if not kept_words:
        return "", None
    text = "".join(str(word.get("word", "")) for word in kept_words).strip()
    probabilities = [float(word["probability"]) for word in kept_words if word.get("probability") is not None]
    confidence = sum(probabilities) / len(probabilities) if probabilities else None
    return text, confidence


def is_probable_hallucination(
    audio_rms: float,
    segments: list[dict[str, Any]],
    word_confidence: float | None,
) -> bool:
    if audio_rms < MIN_AUDIO_RMS:
        return True
    if segments and all(
        float(segment.get("no_speech_prob", 0.0)) >= MAX_NO_SPEECH_PROBABILITY
        for segment in segments
    ):
        return True
    return word_confidence is not None and word_confidence < MIN_WORD_PROBABILITY


@dataclass(frozen=True)
class StreamConfig:
    source: Source
    model_config: ModelConfig
    language: Optional[str] = None
    task: str = "transcribe"
    vad_filter: bool = True


class StreamingSession:
    """Keeps source-specific prompt context while transcribing rolling chunks."""

    def __init__(self, config: StreamConfig, engine: TranscriptionEngine) -> None:
        self.config = config
        self.engine = engine
        self.context = ""
        self.previous_chunk_text = ""
        self.previous_chunk_end = 0.0

    def transcribe_pcm16(self, pcm_bytes: bytes, start_sec: float) -> dict[str, Any]:
        if len(pcm_bytes) % 2:
            raise ValueError("PCM16 phải có số byte chẵn")
        audio = np.frombuffer(pcm_bytes, dtype="<i2").astype(np.float32) / 32768.0
        if audio.size == 0:
            raise ValueError("Chunk PCM rỗng")
        audio_rms = float(np.sqrt(np.mean(np.square(audio), dtype=np.float64)))
        end_sec = start_sec + (audio.size / 16000.0)
        if audio_rms < MIN_AUDIO_RMS:
            self.previous_chunk_end = max(self.previous_chunk_end, end_sec)
            return self._response("", start_sec, end_sec, "", 0.0, 0.0, 0.0)

        result = self.engine.transcribe(
            audio,
            model_config=self.config.model_config,
            language=self.config.language,
            task=self.config.task,
            vad_filter=self.config.vad_filter,
            word_timestamps=True,
            condition_on_previous_text=False,
            hallucination_silence_threshold=1.0,
            initial_prompt=None,
        )
        overlap_seconds = max(0.0, self.previous_chunk_end - start_sec)
        segments = result.get("segments") or []
        text, word_confidence = fresh_text_from_segments(segments, overlap_seconds)
        if not text and overlap_seconds <= 0:
            text = result["text"].strip()
        if is_probable_hallucination(audio_rms, segments, word_confidence):
            text = ""
        text = remove_overlap(self.previous_chunk_text, text)
        if text:
            self.context = f"{self.context} {text}".strip()[-1200:]
        self.previous_chunk_text = text
        self.previous_chunk_end = max(self.previous_chunk_end, end_sec)

        return self._response(
            text,
            start_sec,
            end_sec,
            result["language"],
            result["language_probability"],
            result["inference_seconds"],
            result["rtf"],
        )

    def _response(
        self,
        text: str,
        start_sec: float,
        end_sec: float,
        language: str,
        language_probability: float,
        latency_seconds: float,
        rtf: float,
    ) -> dict[str, Any]:
        return {
            "type": "transcript",
            "source": self.config.source,
            "text": text,
            "start_sec": start_sec,
            "end_sec": end_sec,
            "language": language,
            "language_probability": language_probability,
            "latency_seconds": latency_seconds,
            "rtf": rtf,
        }
