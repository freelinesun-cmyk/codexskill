#!/usr/bin/env python3
"""Generate one or many Doubao Audio Generation files from JSON request files."""

import argparse
import base64
import binascii
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/create"
MODEL = "seed-audio-1.0"


def fail(message: str) -> None:
    print(f"Error: {message}", file=sys.stderr)
    raise SystemExit(1)


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        tmp.write(data)
        temp_path = Path(tmp.name)
    temp_path.replace(path)


def load_request(path: Path) -> dict:
    try:
        body = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"Cannot read request JSON {path}: {exc}")
    if body.get("model") != MODEL:
        fail(f"{path}: model must be {MODEL}")
    prompt = body.get("text_prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        fail(f"{path}: text_prompt must be a non-empty string")
    if len(prompt) > 3000:
        fail(f"{path}: text_prompt exceeds 3000 characters; split the scene first")
    return body


def resolve(value: str, base: Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else base / path


def generate(body: dict, output: Path, subtitle: Optional[Path], api_key: str) -> dict:
    request = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "X-Api-Key": api_key},
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode("utf-8"))
            raise RuntimeError(f"HTTP {exc.code}: {detail.get('message', 'request failed')}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise RuntimeError(f"HTTP {exc.code}: request failed") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError(f"Network request failed: {exc}") from exc
    try:
        audio = base64.b64decode(result.get("audio", ""), validate=True)
    except (ValueError, binascii.Error) as exc:
        raise RuntimeError(f"No valid audio returned: {result.get('message', 'unknown error')}") from exc
    if not audio:
        raise RuntimeError("No audio returned")
    atomic_write(output, audio)
    if subtitle is not None and result.get("subtitle") is not None:
        atomic_write(subtitle, json.dumps(result["subtitle"], ensure_ascii=False, indent=2).encode("utf-8"))
    return {"duration_seconds": result.get("duration"), "bytes": len(audio)}


def parse_items(args: argparse.Namespace) -> list[dict]:
    if args.request:
        if args.output is None:
            fail("--output is required with --request")
        return [{"id": args.request.stem, "request": args.request, "output": args.output, "subtitle": args.subtitle}]
    if args.output or args.subtitle:
        fail("--output and --subtitle belong in the batch manifest")
    try:
        manifest = json.loads(args.batch.read_text(encoding="utf-8"))
        raw_items = manifest["items"]
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
        fail(f"Cannot read batch manifest: {exc}")
    if not isinstance(raw_items, list) or not raw_items:
        fail("Batch manifest must contain a non-empty items array")
    items = []
    for index, item in enumerate(raw_items, 1):
        if not isinstance(item, dict) or not isinstance(item.get("request"), str) or not isinstance(item.get("output"), str):
            fail(f"Batch item {index} needs string request and output fields")
        items.append({
            "id": str(item.get("id", index)),
            "request": resolve(item["request"], args.batch.parent),
            "output": resolve(item["output"], args.batch.parent),
            "subtitle": resolve(item["subtitle"], args.batch.parent) if isinstance(item.get("subtitle"), str) else None,
        })
    return items


def main() -> None:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--request", type=Path, help="One request JSON")
    mode.add_argument("--batch", type=Path, help="Batch manifest JSON")
    parser.add_argument("--output", type=Path, help="Output MP3 for --request")
    parser.add_argument("--subtitle", type=Path, help="Subtitle JSON for --request")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--confirm", action="store_true", help="Required for paid API calls")
    parser.add_argument("--force", action="store_true", help="Allow replacing existing outputs")
    args = parser.parse_args()

    items = parse_items(args)
    runnable = []
    summary = []
    for item in items:
        body = load_request(item["request"])
        state = "ready"
        if item["output"].exists() and not args.force:
            state = "skipped_existing"
        else:
            runnable.append((item, body))
        summary.append({"id": item["id"], "prompt_characters": len(body["text_prompt"]), "output": str(item["output"]), "state": state})
    print(json.dumps({"model": MODEL, "items": summary}, ensure_ascii=False, indent=2))
    if args.dry_run:
        return
    if not args.confirm:
        fail("Pass --confirm only after the user approves this generation")
    if not runnable:
        return
    api_key = os.environ.get("VOLCENGINE_SPEECH_API_KEY")
    if not api_key:
        fail("VOLCENGINE_SPEECH_API_KEY is not set")

    failures = []
    for item, body in runnable:
        try:
            result = generate(body, item["output"], item["subtitle"], api_key)
            print(json.dumps({"id": item["id"], "state": "generated", **result}, ensure_ascii=False))
        except RuntimeError as exc:
            failures.append(item["id"])
            print(json.dumps({"id": item["id"], "state": "failed", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
