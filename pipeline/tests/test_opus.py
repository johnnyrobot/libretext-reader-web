from pathlib import Path

from pipeline.languages import TARGETS
from pipeline.opus import batched, ct2_dir


def test_batches_by_character_budget_not_sentence_count():
    texts = ["x" * 1000] * 10
    batches = list(batched(texts, max_chars=2500))
    assert all(sum(len(t) for t in b) <= 2500 for b in batches)
    assert sum(len(b) for b in batches) == 10


def test_a_single_oversized_sentence_still_gets_its_own_batch():
    texts = ["y" * 9000, "short"]
    batches = list(batched(texts, max_chars=1000))
    assert batches[0] == ["y" * 9000]
    assert sum(len(b) for b in batches) == 2


def test_batching_preserves_order():
    texts = [f"line {i}" for i in range(20)]
    assert [t for b in batched(texts, max_chars=30) for t in b] == texts


def test_model_directory_is_derived_from_the_checkpoint_name():
    path = ct2_dir(TARGETS["es"].forward, Path("/models"))
    assert path == Path("/models/opus-mt-tc-big-en-es")


def test_shared_group_models_resolve_to_one_directory():
    """hr, sl and pl all use opus-mt-en-sla; converting it three times would waste
    disk and time."""
    root = Path("/models")
    assert ct2_dir(TARGETS["hr"].forward, root) == ct2_dir(TARGETS["sl"].forward, root)
    assert ct2_dir(TARGETS["pl"].forward, root) == ct2_dir(TARGETS["sl"].forward, root)
