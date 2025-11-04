"""Fetch PDF submissions from Airtable, grade them, and write back results."""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import tempfile
from pathlib import Path
from typing import Iterable, Optional

import requests

from airtable_client import AirtableClient
from pdf_grader import GradeResult, grade_pdf

LOGGER = logging.getLogger(__name__)


def _env(key: str) -> str:
    try:
        return os.environ[key]
    except KeyError as exc:  # pragma: no cover - configuration guard
        raise SystemExit(f"Missing required environment variable: {key}") from exc


def download_attachment(url: str) -> bytes:
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    return response.content


def format_grade_payload(result: GradeResult) -> str:
    return json.dumps(result.to_json_dict(), indent=2)


def iter_target_records(
    client: AirtableClient,
    pdf_field: str,
    grade_field: str,
    *,
    max_records: Optional[int] = None,
    view: Optional[str] = None,
) -> Iterable[dict]:
    """Yield Airtable records that have a PDF attachment but no grade."""

    processed = 0
    for record in client.iter_records(fields=[pdf_field, grade_field], view=view):
        fields = record.get("fields", {})
        attachments = fields.get(pdf_field) or []
        if not attachments:
            continue
        if fields.get(grade_field):
            continue
        yield record
        processed += 1
        if max_records is not None and processed >= max_records:
            return


def process_record(
    client: AirtableClient,
    record: dict,
    *,
    pdf_field: str,
    grade_field: str,
    use_ocr: bool,
    dry_run: bool,
) -> None:
    attachments = record["fields"].get(pdf_field, [])
    first_attachment = attachments[0]
    url = first_attachment.get("url")
    if not url:
        LOGGER.warning("Record %s has attachment without URL", record.get("id"))
        return

    LOGGER.info("Downloading PDF for record %s", record.get("id"))
    pdf_bytes = download_attachment(url)

    # Use NamedTemporaryFile so PyMuPDF/PyPDF2 can open by path if desired.
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        tmp_path = Path(tmp.name)

    try:
        LOGGER.info("Grading %s", tmp_path.name)
        result = grade_pdf(tmp_path, use_ocr=use_ocr)
        payload = format_grade_payload(result)
        if dry_run:
            LOGGER.info("[dry-run] Would update %s with score %.2f", record.get("id"), result.score)
            print(payload)
        else:
            client.update_record(record["id"], {grade_field: payload})
            LOGGER.info("Updated record %s", record.get("id"))
    finally:
        try:
            tmp_path.unlink()
        except FileNotFoundError:  # pragma: no cover - best effort cleanup
            pass


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Process Airtable PDFs with the heuristic grader")
    parser.add_argument("--max", type=int, default=None, help="Maximum number of records to grade")
    parser.add_argument("--view", type=str, default=None, help="Optional Airtable view to use")
    parser.add_argument("--ocr", action="store_true", help="Enable OCR fallback for scanned PDFs")
    parser.add_argument("--dry-run", action="store_true", help="Print results instead of updating Airtable")
    parser.add_argument("--log-level", default="INFO", help="Logging level (DEBUG, INFO, ...)")
    args = parser.parse_args(list(argv) if argv is not None else None)

    logging.basicConfig(level=getattr(logging, args.log_level.upper(), logging.INFO))

    api_key = _env("AIRTABLE_API_KEY")
    base_id = _env("AIRTABLE_BASE_ID")
    table_name = _env("AIRTABLE_TABLE_NAME")
    pdf_field = _env("AIRTABLE_PDF_FIELD")
    grade_field = _env("AIRTABLE_GRADE_FIELD")

    with AirtableClient(api_key, base_id, table_name) as client:
        records = iter_target_records(
            client,
            pdf_field,
            grade_field,
            max_records=args.max,
            view=args.view,
        )
        processed = 0
        for record in records:
            try:
                process_record(
                    client,
                    record,
                    pdf_field=pdf_field,
                    grade_field=grade_field,
                    use_ocr=args.ocr,
                    dry_run=args.dry_run,
                )
                processed += 1
            except Exception:  # pragma: no cover - operational logging
                LOGGER.exception("Failed to process record %s", record.get("id"))

    LOGGER.info("Finished. Processed %s record(s).", processed)
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    raise SystemExit(main(sys.argv[1:]))
