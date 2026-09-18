#!/usr/bin/env python3
"""Generate one Doubao Audio Generation dialogue track from a JSON request."""

import argparse
import base64
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, required=True, help="JSON request without API keys")
    parser.add_argument("--output", type=Path, required=True, help="Target MP3 path")
    parser.add_argument("--subtitle", type=Path, help="Optional subtitle JSON output")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true", help="Allow replacing an existing output")
    args = parser.parse_args()

    try:
        body = json.loads(args.request.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"Cannot read request JSON: {exc}")

    if body.get("model") != MODEL:
        fail(f"Request model must be {MODEL}")
    prompt = body.get("text_prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        fail("text_prompt must be a non-empty string")
    if len(prompt) > 3000:
        fail("text_prompt exceeds 3000 characters; split the dialogue first")
    if args.output.exists() and not args.force:
        fail(f"Output exists: {args.output}; use --force only with user approval")

    summary = {
        "model": MODEL,
        "prompt_characters": len(prompt),
        "output": str(args.output),
        "subtitle": str(args.subtitle) if args.subtitle else None,
        "references": len(body.get("references", [])),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if args.dry_run:
        return

    api_key = os.environ.get("VOLCENGINE_SPEECH_API_KEY")
    if not api_key:
        fail("VOLCENGINE_SPEECH_API_KEY is not set")

    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "X-Api-Key": api_key},
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode("utf-8"))
            fail(f"HTTP {exc.code}: {detail.get('message', 'request failed')}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            fail(f"HTTP {exc.code}: request failed")
    except (urllib.error.URLError, TimeoutError) as exc:
        fail(f"Network request failed: {exc}")

    audio = result.get("audio")
    if not isinstance(audio, str) or not audio:
        fail(f"No audio returned: {result.get('message', 'unknown error')}")
    try:
        audio_bytes = base64.b64decode(audio, validate=True)
    except ValueError:
        fail("Returned audio is not valid Base64")
    atomic_write(args.output, audio_bytes)

    if args.subtitle and result.get("subtitle") is not None:
        atomic_write(
            args.subtitle,
            json.dumps(result["subtitle"], ensure_ascii=False, indent=2).encode("utf-8"),
        )
    print(json.dumps({"duration_seconds": result.get("duration"), "bytes": len(audio_bytes)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
