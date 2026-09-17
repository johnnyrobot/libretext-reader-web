"""CTranslate2 + Opus-MT: the only module that knows how translation actually runs.

Opus-MT rather than NLLB on licence: every NLLB checkpoint is cc-by-nc-4.0 and its
output would ship inside an MIT product. Opus-MT is apache-2.0, some checkpoints
cc-by-4.0. See the design doc, section 2.1.

Batching is by character budget rather than sentence count. Sentences here average
about 120 characters but range from three words to a long citation, so a fixed
sentence count either wastes padding on short batches or blows memory on long ones.
"""

from collections.abc import Callable, Iterator
from pathlib import Path

from pipeline.languages import Language

DEFAULT_MODEL_ROOT = Path("models/ct2")


def ct2_dir(model_name: str, root: Path = DEFAULT_MODEL_ROOT) -> Path:
    """Converted checkpoints are keyed by checkpoint name, not by language, so the
    three languages sharing opus-mt-en-sla share one conversion."""
    return Path(root) / model_name.split("/")[-1]


def batched(texts: list[str], max_chars: int = 6000) -> Iterator[list[str]]:
    batch: list[str] = []
    size = 0
    for text in texts:
        if batch and size + len(text) > max_chars:
            yield batch
            batch, size = [], 0
        batch.append(text)
        size += len(text)
    if batch:
        yield batch


def make_translator(
    lang: Language,
    root: Path = DEFAULT_MODEL_ROOT,
    reverse: bool = False,
    intra_threads: int = 0,
) -> Callable[[list[str]], list[str]]:
    """Build a Translator over a converted checkpoint.

    The target token is prepended for group and multilingual models. Omitting it
    yields fluent output in the WRONG language -- the model picks a target for you.
    """
    import ctranslate2
    from transformers import AutoTokenizer

    name = lang.reverse if reverse else lang.forward
    token = lang.reverse_token if reverse else lang.forward_token
    directory = ct2_dir(name, root)
    if not directory.exists():
        raise FileNotFoundError(
            f"{directory} not found; run scripts/convert-models.py first"
        )

    tokenizer = AutoTokenizer.from_pretrained(name)
    engine = ctranslate2.Translator(
        str(directory), device="cpu", compute_type="int8", intra_threads=intra_threads
    )

    def translate(lines: list[str]) -> list[str]:
        out: list[str] = []
        for chunk in batched(lines):
            prepared = [f"{token} {line}" if token else line for line in chunk]
            tokens = [tokenizer.convert_ids_to_tokens(tokenizer.encode(p)) for p in prepared]
            results = engine.translate_batch(
                tokens, beam_size=4, max_batch_size=0, replace_unknowns=True
            )
            for result in results:
                ids = tokenizer.convert_tokens_to_ids(result.hypotheses[0])
                out.append(tokenizer.decode(ids, skip_special_tokens=True))
        return out

    return translate
