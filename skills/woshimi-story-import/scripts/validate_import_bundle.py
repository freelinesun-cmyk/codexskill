#!/usr/bin/env python3
import argparse
import html as html_module
import json
import re
import sys
from pathlib import Path


SCHEMA = "woshimi.characterStories.v1"
CATEGORIES = {
    "故事": ("故事", False),
    "投票": ("投票", False),
    "复盘": ("复盘", True),
}
QUESTION_RE = re.compile(r"^\s*(?:\d+\s*[.、．]\s*)?.+[？?]\s*$")
NOTICE_RE = re.compile(r"^【.*(?:题|问题|推理成功).*】$")


def is_vote_heading(text):
    return bool(QUESTION_RE.match(text) or NOTICE_RE.match(text))


def strip_html(value):
    return html_module.unescape(re.sub(r"<[^>]+>", "", value)).strip()


def validate_record(record, label, source):
    errors = []
    for key in ("title", "contentHtml"):
        if key not in record:
            errors.append(f"{source}: 记录缺少 {key}")
    if not record.get("role") and not record.get("roles"):
        errors.append(f"{source}: 记录缺少角色目标 role/roles")
    html = str(record.get("contentHtml", ""))
    if not html.strip():
        errors.append(f"{source}: 正文 HTML 为空")
    if html.count("<p") != html.count("</p>"):
        errors.append(f"{source}: p 标签未闭合")
    if label in {"投票", "复盘"} and html:
        if "font-family:宋体" not in html or "font-size:12pt" not in html:
            errors.append(f"{source}: 未显式写入宋体 12pt")
    if label == "投票" and html:
        colors = re.findall(r"(?<!-)color\s*:\s*([^;\"']+)", html, re.I)
        invalid = sorted({value.strip() for value in colors if value.strip().lower() != "#000000"})
        if invalid:
            errors.append(f"{source}: 投票含非黑色颜色 {invalid}")
        if re.search(
            r"background-color\s*:|text-decoration\s*:\s*underline|<(?:b|strong|u)\b",
            html,
            re.I,
        ):
            errors.append(f"{source}: 投票仍含答案高亮/加粗/下划线")
        for paragraph in re.findall(r"<p\b[^>]*>.*?</p>", html, re.I | re.S):
            if re.search(r"font-weight\s*:\s*(?:bold|[6-9]00)", paragraph, re.I):
                text = strip_html(paragraph)
                if not is_vote_heading(text):
                    errors.append(f"{source}: 非题干段落被加粗: {text[:30]}")
    return errors


def validate_package(path, label):
    errors = []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return [f"{path}: JSON 无法读取: {exc}"], 0
    if data.get("schema") != SCHEMA:
        errors.append(f"{path}: schema 应为 {SCHEMA}")
    records = data.get("records")
    if not isinstance(records, list):
        return errors + [f"{path}: records 不是数组"], 0
    for index, record in enumerate(records, 1):
        if not isinstance(record, dict):
            errors.append(f"{path}: 第 {index} 条记录不是对象")
        else:
            errors.extend(validate_record(record, label, f"{path.name}#{index}"))
    return errors, len(records)


def main():
    parser = argparse.ArgumentParser(description="校验我是谜故事/投票/复盘导入目录")
    parser.add_argument("root", type=Path, help="单个剧本的输出根目录")
    args = parser.parse_args()
    root = args.root.expanduser().resolve()
    errors = []
    totals = {}
    if not root.is_dir():
        print(f"错误：目录不存在：{root}", file=sys.stderr)
        return 2
    for folder_name, (label, optional) in CATEGORIES.items():
        folder = root / folder_name
        if not folder.is_dir():
            if not optional:
                errors.append(f"缺少必需目录：{folder_name}")
            totals[label] = 0
            continue
        packages = sorted(folder.glob("*.json"))
        if not packages and not optional:
            errors.append(f"{folder_name} 目录没有 JSON")
        count = 0
        for package in packages:
            package_errors, record_count = validate_package(package, label)
            errors.extend(package_errors)
            count += record_count
        totals[label] = count
    print("；".join(f"{label} {count} 条" for label, count in totals.items()))
    if errors:
        for error in errors:
            print(f"错误：{error}", file=sys.stderr)
        return 1
    print("校验通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
