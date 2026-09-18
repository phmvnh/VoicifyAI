import numpy as np

from api.engine import ModelConfig
from api.streaming import (
    StreamConfig,
    StreamingSession,
    fresh_text_from_segments,
    is_probable_hallucination,
    remove_overlap,
)


def test_remove_exact_word_overlap():
    assert remove_overlap("xin chào các bạn", "các bạn hôm nay") == "hôm nay"


def test_remove_overlap_is_case_and_punctuation_insensitive():
    assert remove_overlap("Hello, world!", "WORLD, this is new") == "this is new"


def test_keep_text_without_overlap():
    assert remove_overlap("câu trước", "câu tiếp theo") == "câu tiếp theo"


def test_remove_near_duplicate_overlap():
    assert remove_overlap(
        "chúng ta cần hoàn thành kế hoạch trong tuần này",
        "chúng ta cần hoàn tất kế hoạch trong tuần này trước thứ sáu",
    ) == "trước thứ sáu"


def test_word_timestamps_remove_audio_overlap():
    text, confidence = fresh_text_from_segments(
        [{"words": [
            {"start": 0.05, "end": 0.25, "word": " lặp", "probability": 0.9},
            {"start": 0.48, "end": 0.72, "word": " nội", "probability": 0.8},
            {"start": 0.72, "end": 0.95, "word": " dung", "probability": 0.7},
        ]}],
        overlap_seconds=0.5,
    )
    assert text == "nội dung"
    assert confidence == 0.75


def test_silence_and_low_confidence_are_rejected():
    assert is_probable_hallucination(0.0, [], None)
    assert is_probable_hallucination(0.1, [{"no_speech_prob": 0.8}], 0.9)
    assert is_probable_hallucination(0.1, [{"no_speech_prob": 0.1}], 0.1)
    assert not is_probable_hallucination(0.1, [{"no_speech_prob": 0.1}], 0.9)


def test_streaming_disables_previous_text_conditioning():
    class FakeEngine:
        def __init__(self):
            self.kwargs = None

        def transcribe(self, _audio, **kwargs):
            self.kwargs = kwargs
            return {
                "text": "Xin chào",
                "segments": [{"no_speech_prob": 0.1, "words": [
                    {"start": 0.1, "end": 0.5, "word": " Xin", "probability": 0.9},
                    {"start": 0.5, "end": 0.9, "word": " chào", "probability": 0.9},
                ]}],
                "language": "vi",
                "language_probability": 0.99,
                "inference_seconds": 0.1,
                "rtf": 0.1,
            }

    engine = FakeEngine()
    session = StreamingSession(StreamConfig("system", ModelConfig(), language="vi"), engine)
    pcm = (np.ones(16_000, dtype=np.int16) * 2_000).astype("<i2").tobytes()
    response = session.transcribe_pcm16(pcm, 0.0)

    assert response["text"] == "Xin chào"
    assert engine.kwargs["condition_on_previous_text"] is False
    assert engine.kwargs["hallucination_silence_threshold"] == 1.0
    assert engine.kwargs["initial_prompt"] is None
