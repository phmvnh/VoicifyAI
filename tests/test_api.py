import io
import struct

from fastapi.testclient import TestClient

from api.engine import ModelConfig
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
