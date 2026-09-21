#!/usr/bin/env python3
"""验证百变大侦探角色故事导入包的 schema、重复键与 HTML 白名单。"""

from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path


SCHEMA = "baibian.characterStories.v1"
ALLOWED_TAGS = {"div", "br", "b", "span"}
CHANNEL = r"(?:25[0-5]|2[0-4]\d|1?\d?\d)"
COLOR_STYLE = re.compile(rf"^color:\s*rgb\(\s*{CHANNEL}\s*,\s*{CHANNEL}\s*,\s*{CHANNEL}\s*\);?$", re.I)


class StoryHTMLValidator(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.errors: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag not in ALLOWED_TAGS:
            self.errors.append(f"不允许的标签 <{tag}>")
            return
        attrs_dict = {name.lower(): value or "" for name, value in attrs}
        if tag == "span":
            if set(attrs_dict) != {"style"} or not COLOR_STYLE.fullmatch(attrs_dict.get("style", "").strip()):
                self.errors.append("span 只能包含规范的 RGB color style")
        elif attrs_dict:
            self.errors.append(f"<{tag}> 不应包含属性")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)


def normalized(value: object) -> str:
    return " ".join(str(value or "").split())


def find_packages(target: Path) -> list[Path]:
    if target.is_file():
        return [target]
    return sorted(path for path in target.rglob("*.json") if "角色故事导入数据" in path.name)


def validate_file(path: Path) -> tuple[int, list[str]]:
    errors: list[str] = []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return 0, [f"JSON 读取失败: {exc}"]

    if payload.get("schema") != SCHEMA:
        errors.append(f"schema 应为 {SCHEMA}")
    records = payload.get("records")
    if not isinstance(records, list) or not records:
        errors.append("records 必须是非空数组")
        return 0, errors

    keys: set[tuple[str, tuple[str, ...]]] = set()
    for index, record in enumerate(records, 1):
        prefix = f"第 {index} 条"
        if not isinstance(record, dict):
            errors.append(f"{prefix}不是对象")
            continue
        title = normalized(record.get("title"))
        roles = record.get("roles")
        if not title:
            errors.append(f"{prefix}缺少 title")
        if not isinstance(roles, list) or not roles or not all(normalized(role) for role in roles):
            errors.append(f"{prefix}的 roles 必须是非空角色名数组")
            roles = []
        key = (title, tuple(sorted({normalized(role) for role in roles})))
        if key in keys:
            errors.append(f"{prefix}与前文重复（标题 + 角色集合）")
        keys.add(key)
        html = str(record.get("contentHtml") or "")
        text = normalized(record.get("contentText"))
        if not html and not text:
            errors.append(f"{prefix}缺少 contentHtml/contentText")
        if html:
            parser = StoryHTMLValidator()
            try:
                parser.feed(html)
                parser.close()
            except Exception as exc:
                parser.errors.append(f"HTML 解析失败: {exc}")
            errors.extend(f"{prefix}: {error}" for error in parser.errors)
    return len(records), errors


def main() -> int:
    if len(sys.argv) != 2:
        print("用法: validate_baibian_story_package.py <JSON 文件或剧本目录>", file=sys.stderr)
        return 2
    target = Path(sys.argv[1]).expanduser().resolve()
    packages = find_packages(target)
    if not packages:
        print("未找到角色故事导入 JSON。", file=sys.stderr)
        return 1
    total = 0
    all_errors: list[str] = []
    for package in packages:
        count, errors = validate_file(package)
        total += count
        all_errors.extend(f"{package}: {error}" for error in errors)
    if all_errors:
        print("\n".join(all_errors), file=sys.stderr)
        return 1
    print(f"验证通过：{len(packages)} 个 JSON，共 {total} 条角色故事。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
