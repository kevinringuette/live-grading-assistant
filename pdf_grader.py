"""
Standalone PDF extraction and heuristic grading utilities.

This module is intentionally lightweight so it can be imported from
automation scripts or executed as a small CLI for local debugging.

Typical usage:
    from pdf_grader import grade_pdf
    result = grade_pdf("/path/to/file.pdf", use_ocr=True)

When run as a script it accepts a PDF path and optional flags:
    python pdf_grader.py sample.pdf --ocr --json
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import logging
import os
import re
from pathlib import Path
from typing import Iterable, Optional, Sequence, Tuple, Union

try:  # PyMuPDF (fitz) offers fast text extraction when available.
    import fitz  # type: ignore
except ImportError:  # pragma: no cover - optional dependency
    fitz = None  # type: ignore

try:  # Fallback extractor shipped in requirements.
    from PyPDF2 import PdfReader  # type: ignore
except ImportError:  # pragma: no cover - optional dependency
    PdfReader = None  # type: ignore

try:  # Optional OCR support when ``use_ocr=True``.
    import pytesseract  # type: ignore
    from PIL import Image  # type: ignore
except ImportError:  # pragma: no cover - optional dependency
    pytesseract = None  # type: ignore
    Image = None  # type: ignore


LOGGER = logging.getLogger(__name__)

PDFSource = Union[str, os.PathLike, bytes, memoryview]


@dataclasses.dataclass
class GradeBreakdown:
    """Machine-readable metrics computed from the PDF body."""

    word_count: int
    sentence_count: int
    avg_sentence_length: float
    keyword_hits: int
    reading_ease: float


@dataclasses.dataclass
class GradeResult:
    """Container describing the heuristic grade produced for a PDF."""

    score: float
    max_score: float
    passed: bool
    summary: str
    breakdown: GradeBreakdown
    raw_text_preview: str

    def to_json_dict(self) -> dict:
        return {
            "score": round(self.score, 2),
            "max_score": self.max_score,
            "passed": self.passed,
            "summary": self.summary,
            "breakdown": dataclasses.asdict(self.breakdown),
            "raw_text_preview": self.raw_text_preview,
        }


KEYWORDS: Sequence[str] = (
    "analysis",
    "evidence",
    "explain",
    "justify",
    "solution",
    "conclusion",
    "hypothesis",
    "method",
)


def _load_bytes(source: PDFSource) -> bytes:
    if isinstance(source, (bytes, bytearray, memoryview)):
        return bytes(source)
    return Path(source).read_bytes()


def _extract_with_pymupdf(data: bytes, use_ocr: bool) -> Tuple[str, int]:
    if not fitz:
        raise RuntimeError("PyMuPDF is not installed")

    doc = fitz.open(stream=data, filetype="pdf")
    try:
        texts: list[str] = []
        page_count = doc.page_count
        for page in doc:
            content = page.get_text("text").strip()
            if content:
                texts.append(content)
                continue
            if use_ocr and pytesseract and Image:
                pix = page.get_pixmap()
                mode = "RGBA" if pix.alpha else "RGB"
                image = Image.frombytes(mode, [pix.width, pix.height], pix.samples)
                texts.append(pytesseract.image_to_string(image))
        return "\n\n".join(texts), page_count
    finally:
        doc.close()


def _extract_with_pypdf2(data: bytes) -> Tuple[str, int]:
    if not PdfReader:
        raise RuntimeError("PyPDF2 is not installed")

    import io

    reader = PdfReader(io.BytesIO(data))
    texts: list[str] = []
    for page in reader.pages:
        texts.append(page.extract_text() or "")
    return "\n\n".join(texts), len(reader.pages)


def extract_text(source: PDFSource, use_ocr: bool = False) -> Tuple[str, int]:
    """Return the extracted text content and page count for *source*.

    ``source`` can be a filesystem path or an in-memory buffer.
    ``use_ocr`` triggers an OCR pass when PyMuPDF is installed and a page
    contains no selectable text. OCR support requires ``pytesseract`` and
    ``Pillow``.
    """

    data = _load_bytes(source)

    if fitz is not None:
        try:
            return _extract_with_pymupdf(data, use_ocr)
        except Exception as exc:  # pragma: no cover - safety net
            LOGGER.warning("PyMuPDF extraction failed, falling back to PyPDF2", exc_info=exc)

    if PdfReader is not None:
        # Lazily import io so that consumers that only rely on PyMuPDF do not
        # incur the cost when unnecessary.
        import io

        return _extract_with_pypdf2(data)

    raise RuntimeError(
        "No PDF extraction backend available. Install PyMuPDF or PyPDF2."
    )


def _flesch_reading_ease(words: int, sentences: int, syllables: int) -> float:
    if words == 0 or sentences == 0:
        return 0.0
    # Classic Flesch Reading Ease formula.
    return 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words)


def _estimate_syllables(tokens: Iterable[str]) -> int:
    count = 0
    for token in tokens:
        token = token.lower()
        token = re.sub(r"[^a-z]", "", token)
        if not token:
            continue
        syllables = re.findall(r"[aeiouy]+", token)
        count += max(1, len(syllables))
    return count


def _summarize_text(text: str) -> Tuple[GradeBreakdown, str]:
    tokens = re.findall(r"[\w']+", text)
    word_count = len(tokens)
    sentences = re.split(r"(?<=[.!?])\s+", text.strip()) if text.strip() else []
    sentences = [s for s in sentences if s]
    sentence_count = len(sentences)
    avg_sentence_length = (word_count / sentence_count) if sentence_count else 0.0

    hits = sum(1 for kw in KEYWORDS if kw in text.lower())
    syllables = _estimate_syllables(tokens[:2000])  # cap for speed
    reading_ease = _flesch_reading_ease(word_count or 1, sentence_count or 1, syllables)

    breakdown = GradeBreakdown(
        word_count=word_count,
        sentence_count=sentence_count,
        avg_sentence_length=round(avg_sentence_length, 2),
        keyword_hits=hits,
        reading_ease=round(reading_ease, 2),
    )

    preview = text.strip().splitlines()
    preview_text = "\n".join(preview[:5])[:400]
    return breakdown, preview_text


def _score_from_breakdown(breakdown: GradeBreakdown) -> Tuple[float, str]:
    score = 0.0
    comments: list[str] = []

    # Word count targets (simple heuristic thresholds)
    if breakdown.word_count >= 400:
        score += 4
        comments.append("Strong word count")
    elif breakdown.word_count >= 250:
        score += 3
        comments.append("Adequate length")
    elif breakdown.word_count >= 150:
        score += 2
        comments.append("Short but usable response")
    else:
        score += 1
        comments.append("Response is very brief")

    # Keyword usage encourages addressing rubric terminology.
    score += min(3, breakdown.keyword_hits)
    if breakdown.keyword_hits >= 3:
        comments.append("Incorporates rubric vocabulary")
    elif breakdown.keyword_hits:
        comments.append("Some rubric vocabulary present")
    else:
        comments.append("Consider referencing rubric terms")

    # Reading ease sweet spot between 40 and 80.
    if 40 <= breakdown.reading_ease <= 80:
        score += 2
        comments.append("Readable sentence structure")
    else:
        comments.append("Sentence complexity outside ideal range")

    # Bonus for balanced sentence length.
    if 12 <= breakdown.avg_sentence_length <= 24:
        score += 1
        comments.append("Balanced sentence length")
    else:
        comments.append("Vary sentence lengths for clarity")

    max_score = 10.0
    score = min(max_score, score)
    passed = score >= 6.0

    summary = "; ".join(comments)
    return score, summary


def grade_pdf(source: PDFSource, use_ocr: bool = False) -> GradeResult:
    """Grade *source* using lightweight heuristics.

    Returns a :class:`GradeResult` containing the score and supporting
    breakdown information. ``source`` can be a path or bytes.
    """

    text, _page_count = extract_text(source, use_ocr=use_ocr)
    breakdown, preview = _summarize_text(text)
    score, summary = _score_from_breakdown(breakdown)
    return GradeResult(
        score=score,
        max_score=10.0,
        passed=score >= 6.0,
        summary=summary,
        breakdown=breakdown,
        raw_text_preview=preview,
    )


def _cli(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Heuristic PDF grading helper")
    parser.add_argument("pdf", type=Path, help="Path to the PDF file to grade")
    parser.add_argument("--ocr", action="store_true", help="Enable OCR fallback for image-based PDFs")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of the formatted summary")
    args = parser.parse_args(argv)

    if not args.pdf.exists():
        parser.error(f"PDF not found: {args.pdf}")

    result = grade_pdf(args.pdf, use_ocr=args.ocr)

    if args.json:
        print(json.dumps(result.to_json_dict(), indent=2))
    else:
        print(f"Score: {result.score:.2f}/{result.max_score}")
        print(f"Passed: {'yes' if result.passed else 'no'}")
        print("Summary:", result.summary)
        print("Breakdown:")
        for key, value in dataclasses.asdict(result.breakdown).items():
            print(f"  - {key}: {value}")
        if result.raw_text_preview:
            print("Preview:\n" + result.raw_text_preview)

    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    raise SystemExit(_cli())
