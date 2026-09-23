from huggingface_hub import constants

from api.model_manager import MODEL_CATALOG, ModelDownloadManager


def test_curated_catalog_includes_lightweight_models():
    assert MODEL_CATALOG["tiny"]["repo_id"] == "Systran/faster-whisper-tiny"
    assert MODEL_CATALOG["base"]["repo_id"] == "Systran/faster-whisper-base"


def test_remove_cache_only_deletes_the_resolved_model_directory(monkeypatch, tmp_path):
    monkeypatch.setattr(constants, "HF_HUB_CACHE", str(tmp_path))
    model_cache = tmp_path / "models--Example--whisper"
    keep = tmp_path / "models--Example--keep"
    (model_cache / "blobs").mkdir(parents=True)
    keep.mkdir()
    (model_cache / "blobs" / "model.bin").write_bytes(b"weights")

    ModelDownloadManager._remove_cache("Example/whisper")

    assert not model_cache.exists()
    assert keep.exists()
