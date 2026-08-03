from __future__ import annotations

import json
import os
import re
import struct
import urllib.error
import urllib.request
from html import unescape
from pathlib import Path
from typing import Any

MODEL_ID = "6kFNcL9OnO"
MODEL_PAGE = f"https://poly.pizza/m/{MODEL_ID}"
API_URL = f"https://api.poly.pizza/v1/model/{MODEL_ID}"
OUTPUT = Path("public/models/hyper-casual-character.glb")


def request(url: str, headers: dict[str, str] | None = None) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Recycle-Factory-GitHub-Actions/1.0",
            "Accept": "*/*",
            **(headers or {}),
        },
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read()


def find_download_url(value: Any) -> str | None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key.lower() == "download" and isinstance(item, str) and item.startswith("http"):
                return item
        for item in value.values():
            found = find_download_url(item)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = find_download_url(item)
            if found:
                return found
    return None


def parse_json_download(raw: bytes) -> str | None:
    try:
        return find_download_url(json.loads(raw.decode("utf-8")))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None


def parse_html_download(raw: bytes) -> str | None:
    text = unescape(raw.decode("utf-8", errors="replace")).replace("\\u0026", "&").replace("\\/", "/")

    patterns = (
        r'"Download"\s*:\s*"([^"]+)"',
        r'"download"\s*:\s*"([^"]+)"',
        r"(https://[^\"'<> ]+\.glb(?:\?[^\"'<> ]*)?)",
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return match.group(1)

    next_data = re.search(
        r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
        text,
        flags=re.DOTALL,
    )
    if not next_data:
        return None

    found = parse_json_download(next_data.group(1).encode("utf-8"))
    if found:
        return found

    try:
        payload = json.loads(next_data.group(1))
        build_id = payload.get("buildId")
        if build_id:
            data_url = f"https://poly.pizza/_next/data/{build_id}/m/{MODEL_ID}.json"
            return parse_json_download(request(data_url))
    except (json.JSONDecodeError, urllib.error.URLError):
        return None

    return None


def resolve_download() -> str:
    headers: dict[str, str] = {}
    api_key = os.environ.get("POLY_PIZZA_KEY", "").strip()
    if api_key:
        headers["X-Auth-Token"] = api_key

    try:
        found = parse_json_download(request(API_URL, headers))
        if found:
            print("Resolved model through Poly Pizza API.")
            return found
    except urllib.error.HTTPError as error:
        print(f"Poly Pizza API returned HTTP {error.code}; trying page metadata.")
    except urllib.error.URLError as error:
        print(f"Poly Pizza API request failed: {error}; trying page metadata.")

    found = parse_html_download(request(MODEL_PAGE))
    if found:
        print("Resolved model through Poly Pizza page metadata.")
        return found

    raise RuntimeError("Could not resolve the Poly Pizza GLB download URL")


def validate_glb(data: bytes) -> None:
    if len(data) < 20:
        raise ValueError("GLB file is unexpectedly small")
    magic, version, declared_length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2 or declared_length != len(data):
        raise ValueError("Downloaded file is not a valid GLB 2.0 asset")


def main() -> None:
    if OUTPUT.is_file() and OUTPUT.stat().st_size > 0:
        data = OUTPUT.read_bytes()
        validate_glb(data)
        print(f"Existing GLB validated: {len(data)} bytes")
        return

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    data = request(resolve_download())
    validate_glb(data)
    OUTPUT.write_bytes(data)
    print(f"Downloaded and validated GLB: {len(data)} bytes")


if __name__ == "__main__":
    main()
