from pathlib import Path

from api.gpu_runtime import GpuRuntimeManager, REQUIRED_DLLS


def test_runtime_status_detects_only_complete_app_local_runtime(tmp_path: Path):
    manager = GpuRuntimeManager(tmp_path / "cuda12")
    cublas = manager.root / "nvidia" / "cublas" / "bin"
    cudnn = manager.root / "nvidia" / "cudnn" / "bin"
    cublas.mkdir(parents=True)
    cudnn.mkdir(parents=True)
    for filename in REQUIRED_DLLS:
        directory = cudnn if filename.startswith("cudnn") else cublas
        (directory / filename).write_bytes(b"runtime")

    status = manager.status()

    assert status["installed"] is True
    assert status["size_bytes"] == len(REQUIRED_DLLS) * len(b"runtime")


def test_remove_worker_only_removes_managed_runtime(tmp_path: Path):
    manager = GpuRuntimeManager(tmp_path / "runtime" / "cuda12")
    manager.root.mkdir(parents=True)
    (manager.root / "owned.dll").write_bytes(b"owned")
    sibling = manager.root.parent / "keep.txt"
    sibling.write_text("keep", encoding="utf-8")

    manager._remove_worker()

    assert not manager.root.exists()
    assert sibling.read_text(encoding="utf-8") == "keep"
