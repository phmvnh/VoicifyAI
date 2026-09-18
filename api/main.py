"""FastAPI REST entry point for the local VoicifyAI backend."""

from __future__ import annotations

import io
import json
import struct
from typing import Annotated, Any, Literal, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from faster_whisper import available_models

from api.engine import EngineError, ModelConfig, engine
from api.streaming import StreamConfig, StreamingSession


MAX_AUDIO_BYTES = 512 * 1024 * 1024
RecognitionLanguage = Literal[
    "vi", "en", "zh", "ja", "ko", "fr", "de", "es", "pt", "it", "ru", "th", "ar"
]
LANGUAGE_CODES: tuple[RecognitionLanguage, ...] = (
    "vi",
    "en",
    "zh",
    "ja",
    "ko",
    "fr",
    "de",
    "es",
    "pt",
    "it",
    "ru",
    "th",
    "ar",
)


class BatchConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str = "tiny"
    device: Literal["auto", "cpu", "cuda"] = "auto"
    quantization: str = "default"
    device_index: int = 0
    cpu_threads: int = Field(default=0, ge=0)
    num_workers: int = Field(default=1, ge=1)
    download_root: Optional[str] = None
    local_files_only: bool = False
    language: Optional[RecognitionLanguage] = None
    task: Literal["transcribe", "translate"] = "transcribe"
    vad_filter: bool = True
    word_timestamps: bool = True
    initial_prompt: Optional[str] = None
    hotwords: Optional[str] = None


class StreamHandshake(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["mic", "system"]
    config: BatchConfig = Field(default_factory=BatchConfig)


app = FastAPI(
    title="VoicifyAI Local API",
    version="0.1.0",
    description="API local cho ứng dụng VoicifyAI Desktop.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:1420",
        "http://localhost:1420",
        "https://tauri.localhost",
        "tauri://localhost",
    ],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/v1/health")
def health() -> dict[str, Any]:
    status = engine.status()
    active = status["model_config"] or {}
    return {
        "status": "ok",
        "model_loaded": status["model_loaded"],
        "model": active.get("model"),
        "device": active.get("device"),
        "quantization": active.get("compute_type"),
    }


@app.get("/v1/models")
def models() -> dict[str, list[str]]:
    return {"models": available_models()}


@app.get("/v1/languages")
def languages() -> dict[str, list[str]]:
    return {"languages": list(LANGUAGE_CODES)}


def _parse_config(raw_config: str) -> BatchConfig:
    try:
        payload = json.loads(raw_config)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="config phải là JSON hợp lệ") from exc
    try:
        return BatchConfig.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc


@app.post("/v1/transcribe/batch")
async def transcribe_batch(
    audio: Annotated[UploadFile, File(description="File âm thanh cần nhận diện")],
    config: Annotated[str, Form(description="Cấu hình nhận diện ở dạng JSON")] = "{}",
) -> dict[str, Any]:
    batch_config = _parse_config(config)
    audio_bytes = await audio.read(MAX_AUDIO_BYTES + 1)
    await audio.close()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="File âm thanh rỗng")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="File âm thanh vượt quá giới hạn 512 MB")

    model_config = ModelConfig(
        model=batch_config.model,
        device=batch_config.device,
        compute_type=batch_config.quantization,
        device_index=batch_config.device_index,
        cpu_threads=batch_config.cpu_threads,
        num_workers=batch_config.num_workers,
        download_root=batch_config.download_root,
        local_files_only=batch_config.local_files_only,
    )
    try:
        return await run_in_threadpool(
            engine.transcribe,
            io.BytesIO(audio_bytes),
            model_config=model_config,
            language=batch_config.language,
            task=batch_config.task,
            vad_filter=batch_config.vad_filter,
            word_timestamps=batch_config.word_timestamps,
            initial_prompt=batch_config.initial_prompt,
            hotwords=batch_config.hotwords,
        )
    except EngineError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.websocket("/v1/transcribe/stream")
async def transcribe_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        handshake = StreamHandshake.model_validate_json(await websocket.receive_text())
    except (ValidationError, ValueError) as exc:
        await websocket.send_json({"type": "error", "message": f"Handshake không hợp lệ: {exc}"})
        await websocket.close(code=1008)
        return

    config = handshake.config
    session = StreamingSession(
        StreamConfig(
            source=handshake.source,
            model_config=ModelConfig(
                model=config.model,
                device=config.device,
                compute_type=config.quantization,
                device_index=config.device_index,
                cpu_threads=config.cpu_threads,
                num_workers=config.num_workers,
                download_root=config.download_root,
                local_files_only=config.local_files_only,
            ),
            language=config.language,
            task=config.task,
            vad_filter=config.vad_filter,
        ),
        engine,
    )
    await websocket.send_json({"type": "ready", "source": handshake.source})

    try:
        while True:
            packet = await websocket.receive_bytes()
            if len(packet) < 10:
                await websocket.send_json({"type": "error", "message": "Gói PCM quá ngắn"})
                continue
            start_sec = struct.unpack("<d", packet[:8])[0]
            try:
                result = await run_in_threadpool(session.transcribe_pcm16, packet[8:], start_sec)
                await websocket.send_json(result)
            except (EngineError, ValueError) as exc:
                await websocket.send_json({"type": "error", "message": str(exc)})
    except WebSocketDisconnect:
        return


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api.main:app", host="127.0.0.1", port=8765)
