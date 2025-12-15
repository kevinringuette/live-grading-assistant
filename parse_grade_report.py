"""Utility to convert tab-separated rubric exports into structured JSON.

The expected input format is one row per rubric line with tab-separated
fields in the order:

    course\tstudent_name\tstudent_id\tassignment\trubric_category\trubric_item\tscore\tcomment?

Additional trailing columns are ignored. Rows with fewer than 7 columns are
skipped. The output groups rows by student and assignment, sums rubric
scores, and emits a JSON document to stdout.

Lines that contain literal "\\t" sequences (instead of actual tab characters)
are automatically normalized.
"""

import argparse
import json
from typing import Dict, List, Any


def parse_rows(lines: List[str]) -> List[Dict[str, Any]]:
    """Parse TSV lines into aggregated student records."""
    grouped: Dict[str, Dict[str, Any]] = {}

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        # Support both literal tab characters and escaped "\t" sequences
        # (common when data is pasted from logs).
        if "\t" not in line and "\\t" in line:
            line = line.replace("\\t", "\t")

        parts = line.split("\t")
        if len(parts) < 7:
            # Not enough fields to be meaningful.
            continue

        course, student_name, student_id, assignment = parts[:4]
        rubric_category, rubric_item, score_text = parts[4:7]
        comment = parts[7].strip() if len(parts) > 7 else ""

        try:
            score = float(score_text)
        except ValueError:
            continue

        key = f"{assignment}::{student_id}"
        record = grouped.setdefault(
            key,
            {
                "course": course,
                "assignment": assignment,
                "student_id": student_id,
                "student_name": student_name,
                "rubric": [],
                "total_score": 0.0,
            },
        )

        record["rubric"].append(
            {
                "category": rubric_category,
                "item": rubric_item,
                "score": score,
                "comment": comment,
            }
        )
        record["total_score"] += score

    return list(grouped.values())


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert TSV rubric rows to aggregated JSON.")
    parser.add_argument(
        "tsv_file",
        nargs="?",
        type=argparse.FileType("r"),
        default="-",
        help="Path to the TSV file (defaults to stdin).",
    )
    args = parser.parse_args()

    lines = args.tsv_file.readlines()
    results = parse_rows(lines)
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
