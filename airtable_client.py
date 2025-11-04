"""Minimal Airtable REST API helper used by PDF grading automation."""
from __future__ import annotations

import logging
from typing import Dict, Generator, Iterable, Optional
from urllib.parse import quote

import requests

LOGGER = logging.getLogger(__name__)


class AirtableClient:
    """Thin wrapper around the Airtable REST API v0."""

    api_key: str
    base_id: str
    table_name: str

    def __init__(self, api_key: str, base_id: str, table_name: str, *, timeout: int = 30) -> None:
        self.api_key = api_key
        self.base_id = base_id
        self.table_name = table_name
        self.timeout = timeout
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        })

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    @property
    def _base_url(self) -> str:
        return f"https://api.airtable.com/v0/{self.base_id}/{quote(self.table_name)}"

    def _request(self, method: str, path: str = "", **kwargs) -> requests.Response:
        url = f"{self._base_url}{path}"
        response = self._session.request(method, url, timeout=self.timeout, **kwargs)
        try:
            response.raise_for_status()
        except requests.HTTPError:
            LOGGER.error("Airtable request failed: %s %s -> %s", method, url, response.text)
            raise
        return response

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def iter_records(
        self,
        *,
        page_size: int = 100,
        fields: Optional[Iterable[str]] = None,
        filter_formula: Optional[str] = None,
        view: Optional[str] = None,
    ) -> Generator[Dict, None, None]:
        """Yield records from the Airtable table with automatic pagination."""

        params: list[tuple[str, str]] = [("pageSize", str(page_size))]
        if fields:
            for field in fields:
                params.append(("fields[]", field))
        if filter_formula:
            params.append(("filterByFormula", filter_formula))
        if view:
            params.append(("view", view))

        offset: Optional[str] = None
        while True:
            if offset:
                params_with_offset = params + [("offset", offset)]
            else:
                params_with_offset = params
            response = self._request("GET", params=params_with_offset)
            payload = response.json()
            for record in payload.get("records", []):
                yield record
            offset = payload.get("offset")
            if not offset:
                break

    def update_record(self, record_id: str, fields: Dict) -> Dict:
        """Update the provided record and return the Airtable response."""

        response = self._request("PATCH", f"/{record_id}", json={"fields": fields})
        return response.json()

    def close(self) -> None:
        self._session.close()

    def __enter__(self) -> "AirtableClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()
