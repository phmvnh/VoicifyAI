import io
import struct

from fastapi.testclient import TestClient

from api.engine import ModelConfig
from api import main
from api.main import app, engine


client = TestClient(app)


def test_health_before_model_load(monkeypatch):
    monkeypatch.setattr(engine, "status", lambda: {"model_loaded": False, "model_config": None})
    response = client.get("/v1/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "model_loaded": False,
        "model": None,
        "device": None,
        "quantization": None,
    }


def test_models_comes_from_library():
    response = client.get("/v1/models")
    assert response.status_code == 200
    assert "tiny" in response.json()["models"]
    assert "large-v3" in response.json()["models"]


def test_model_statuses_contract(monkeypatch):
    statuses = [{
        "id": "turbo",
        "label": "Whisper Turbo",
        "description": "Khuyên dùng",
        "downloaded": True,
        "downloading": False,
        "size_bytes": 123,
        "total_bytes": None,
        "error": None,
    }]
    monkeypatch.setattr(main.model_downloads, "list_statuses", lambda: statuses)

    response = client.get("/v1/models/status")

    assert response.status_code == 200
    assert response.json() == {"models": statuses}


def test_start_model_download(monkeypatch):
    status = {"id": "small", "downloaded": False, "downloading": True}
    monkeypatch.setattr(main.model_downloads, "start_download", lambda model: status)

    response = client.post("/v1/models/small/download")

    assert response.status_code == 202
    assert response.json() == status


def test_start_unknown_model_download_returns_not_found(monkeypatch):
    def reject(_model):
        raise ValueError("Model không hợp lệ")

    monkeypatch.setattr(main.model_downloads, "start_download", reject)

    response = client.post("/v1/models/unknown/download")

    assert response.status_code == 404


def test_cancel_model_download(monkeypatch):
    status = {"id": "small", "downloaded": False, "downloading": True, "cancel_requested": True}
    monkeypatch.setattr(main.model_downloads, "cancel_download", lambda model: status)

    response = client.delete("/v1/models/small/download")

    assert response.status_code == 200
    assert response.json() == status


def test_remove_model_unloads_engine_and_starts_background_removal(monkeypatch):
    status = {"id": "medium", "downloaded": True, "removing": True}
    unloaded = []
    monkeypatch.setattr(type(engine), "is_busy", property(lambda _self: False))
    monkeypatch.setattr(engine, "unload", lambda model: unloaded.append(model))
    monkeypatch.setattr(main.model_downloads, "start_remove", lambda model: status)

    response = client.delete("/v1/models/medium")

    assert response.status_code == 202
    assert response.json() == status
    assert unloaded == ["medium"]


def test_remove_model_is_blocked_while_engine_is_busy(monkeypatch):
    monkeypatch.setattr(type(engine), "is_busy", property(lambda _self: True))

    response = client.delete("/v1/models/medium")

    assert response.status_code == 409


def test_hardware_reports_cuda_capabilities(monkeypatch):
    monkeypatch.setattr(
        main,
        "detect_cpu",
        lambda: {"compute_types": ["float32", "int8", "int8_float32"], "error": None},
    )
    monkeypatch.setattr(
        main,
        "detect_cuda",
        lambda: {
            "available": True,
            "device_count": 1,
            "compute_types": ["float16", "int8_float16"],
            "error": None,
        },
    )
    response = client.get("/v1/hardware")
    assert response.status_code == 200
    assert response.json()["cpu"] == {
        "compute_types": ["float32", "int8", "int8_float32"],
        "error": None,
    }
    assert response.json()["cuda"] == {
        "available": True,
        "device_count": 1,
        "compute_types": ["float16", "int8_float16"],
        "error": None,
    }


def test_gpu_runtime_status(monkeypatch):
    status = {
        "installed": False,
        "installing": False,
        "cancel_requested": False,
        "removing": False,
        "version": "12",
        "size_bytes": 0,
        "estimated_download_bytes": 1_300_000_000,
        "error": None,
    }
    monkeypatch.setattr(main.gpu_runtime, "status", lambda: status)

    response = client.get("/v1/runtime/gpu/status")

    assert response.status_code == 200
    assert response.json() == status


def test_gpu_runtime_install_and_cancel(monkeypatch):
    installing = {"installing": True}
    cancelled = {"installing": True, "cancel_requested": True}
    monkeypatch.setattr(main.gpu_runtime, "start_install", lambda: installing)
    monkeypatch.setattr(main.gpu_runtime, "cancel_install", lambda: cancelled)

    install_response = client.post("/v1/runtime/gpu/install")
    cancel_response = client.delete("/v1/runtime/gpu/install")

    assert install_response.status_code == 202
    assert install_response.json() == installing
    assert cancel_response.status_code == 200
    assert cancel_response.json() == cancelled


def test_gpu_runtime_remove_is_blocked_while_engine_is_busy(monkeypatch):
    monkeypatch.setattr(type(engine), "is_busy", property(lambda _self: True))

    response = client.delete("/v1/runtime/gpu")

    assert response.status_code == 409


def test_languages_returns_supported_recognition_languages():
    response = client.get("/v1/languages")
    assert response.status_code == 200
    assert response.json()["languages"] == [
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
    ]


def test_batch_rejects_unsupported_language():
    response = client.post(
        "/v1/transcribe/batch",
        files={"audio": ("speech.wav", b"RIFFaudio", "audio/wav")},
        data={"config": '{"language":"nl"}'},
    )
    assert response.status_code == 422


def test_local_frontend_cors_preflight():
    response = client.options(
        "/v1/transcribe/batch",
        headers={
            "Origin": "http://127.0.0.1:1420",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:1420"


def test_tauri_windows_frontend_cors_preflight():
    response = client.options(
        "/v1/models/tiny/download",
        headers={
            "Origin": "http://tauri.localhost",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://tauri.localhost"


def test_batch_transcription_contract(monkeypatch):
    captured = {}

    def fake_transcribe(audio, **kwargs):
        captured["bytes"] = audio.read()
        captured.update(kwargs)
        return {
            "text": "Xin chào",
            "segments": [],
            "language": "vi",
            "language_probability": 0.99,
            "duration": 1.0,
            "duration_after_vad": 1.0,
            "inference_seconds": 0.2,
            "rtf": 0.2,
        }

    monkeypatch.setattr(engine, "transcribe", fake_transcribe)
    response = client.post(
        "/v1/transcribe/batch",
        files={"audio": ("speech.wav", io.BytesIO(b"RIFFaudio"), "audio/wav")},
        data={"config": '{"model":"small","language":"vi","quantization":"int8"}'},
    )

    assert response.status_code == 200
    assert response.json()["text"] == "Xin chào"
    assert captured["bytes"] == b"RIFFaudio"
    assert captured["language"] == "vi"
    assert captured["model_config"] == ModelConfig(
        model="small", device="auto", compute_type="int8"
    )


def test_batch_rejects_invalid_config():
    response = client.post(
        "/v1/transcribe/batch",
        files={"audio": ("speech.wav", b"RIFFaudio", "audio/wav")},
        data={"config": '{"task":"summarize"}'},
    )
    assert response.status_code == 422


def test_batch_rejects_empty_audio():
    response = client.post(
        "/v1/transcribe/batch",
        files={"audio": ("empty.wav", b"", "audio/wav")},
    )
    assert response.status_code == 400


def test_streaming_websocket_contract(monkeypatch):
    def fake_transcribe(audio, **kwargs):
        assert audio.shape == (16000,)
        return {
            "text": "Xin chào",
            "segments": [],
            "language": "vi",
            "language_probability": 0.98,
            "duration": 1.0,
            "duration_after_vad": 1.0,
            "inference_seconds": 0.1,
            "rtf": 0.1,
        }

    monkeypatch.setattr(engine, "transcribe", fake_transcribe)
    with client.websocket_connect("/v1/transcribe/stream") as websocket:
        websocket.send_json({"source": "mic", "config": {"model": "tiny"}})
        assert websocket.receive_json() == {"type": "ready", "source": "mic"}
        packet = struct.pack("<d", 2.5) + struct.pack("<h", 2_000) * 16000
        websocket.send_bytes(packet)
        response = websocket.receive_json()

    assert response["type"] == "transcript"
    assert response["source"] == "mic"
    assert response["text"] == "Xin chào"
    assert response["start_sec"] == 2.5
    assert response["end_sec"] == 3.5
