#!/usr/bin/env python3
"""生成无裁切、透明背景的往返缩放 GIF 和动画 WebP。"""

from __future__ import annotations

import argparse
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, features


DURATION_SECONDS = 2
TARGET_BYTES = 3 * 1024 * 1024
SAFETY_MARGIN = 8
GIF_OPTIONS = ((48, 256), (24, 256), (24, 128), (16, 128), (16, 64))
WEBP_QUALITIES = (82, 75, 68)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="根据透明 PNG 生成无裁切的循环放大 GIF 与动画 WebP。"
    )
    parser.add_argument("input", type=Path, help="透明 PNG 原图")
    parser.add_argument("--scale", required=True, type=float, help="最大放大倍率，必须大于 1")
    parser.add_argument("--output-dir", type=Path, help="输出目录，默认使用原图所在目录")
    parser.add_argument("--overwrite", action="store_true", help="覆盖同名输出文件")
    return parser.parse_args()


def output_paths(source: Path, scale: float, output_dir: Path) -> tuple[Path, Path]:
    suffix = f"_缩放循环_{scale:g}x"
    return output_dir / f"{source.stem}{suffix}.gif", output_dir / f"{source.stem}{suffix}.webp"


def make_frames(source: Image.Image, scale: float, count: int) -> list[Image.Image]:
    source = source.convert("RGBA")
    source_w, source_h = source.size
    canvas_w = math.ceil(source_w * scale) + SAFETY_MARGIN
    canvas_h = math.ceil(source_h * scale) + SAFETY_MARGIN
    base = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    base.alpha_composite(source, ((canvas_w - source_w) // 2, (canvas_h - source_h) // 2))

    frames: list[Image.Image] = []
    for index in range(count):
        progress = index / (count - 1)
        zoom = 1 + (scale - 1) * (1 - abs(2 * progress - 1))
        enlarged = base.resize(
            (round(canvas_w * zoom), round(canvas_h * zoom)), Image.Resampling.LANCZOS
        )
        frame = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        frame.alpha_composite(
            enlarged, ((canvas_w - enlarged.width) // 2, (canvas_h - enlarged.height) // 2)
        )
        frames.append(frame)
    return frames


def write_frame_sequence(frames: list[Image.Image], directory: Path) -> None:
    for index, frame in enumerate(frames):
        frame.save(directory / f"frame_{index:03d}.png")


def encode_gif(frames: list[Image.Image], color_count: int, destination: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise RuntimeError("生成优化后的 GIF 需要安装 ffmpeg。")
    fps = len(frames) / DURATION_SECONDS
    with tempfile.TemporaryDirectory(prefix="zoom-animation-") as temp_dir:
        frame_dir = Path(temp_dir)
        write_frame_sequence(frames, frame_dir)
        filters = (
            "[0:v]split[a][b];"
            f"[a]palettegen=reserve_transparent=1:max_colors={color_count}[palette];"
            "[b][palette]paletteuse=alpha_threshold=128"
        )
        subprocess.run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-framerate",
                str(fps),
                "-i",
                str(frame_dir / "frame_%03d.png"),
                "-filter_complex",
                filters,
                "-loop",
                "0",
                str(destination),
            ],
            check=True,
        )


def create_gif(source: Image.Image, scale: float, destination: Path) -> list[Image.Image]:
    last_frames: list[Image.Image] | None = None
    for count, colors in GIF_OPTIONS:
        frames = make_frames(source, scale, count)
        encode_gif(frames, colors, destination)
        last_frames = frames
        if destination.stat().st_size <= TARGET_BYTES:
            return frames
    assert last_frames is not None
    return last_frames


def create_webp(frames: list[Image.Image], destination: Path) -> int:
    frame_duration = round(DURATION_SECONDS * 1000 / len(frames))
    for quality in WEBP_QUALITIES:
        frames[0].save(
            destination,
            format="WEBP",
            save_all=True,
            append_images=frames[1:],
            duration=frame_duration,
            loop=0,
            quality=quality,
            method=5,
        )
        if destination.stat().st_size <= TARGET_BYTES:
            return quality
    return WEBP_QUALITIES[-1]


def main() -> int:
    args = parse_args()
    source = args.input.expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"找不到输入图片：{source}")
    if source.suffix.lower() != ".png":
        raise ValueError("输入必须是 PNG，才能保留透明通道。")
    if args.scale <= 1:
        raise ValueError("--scale 必须大于 1。")
    if not features.check("webp_anim"):
        raise RuntimeError("当前 Pillow 未启用动画 WebP 支持。")

    output_dir = (args.output_dir or source.parent).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    gif_path, webp_path = output_paths(source, args.scale, output_dir)
    existing = [path for path in (gif_path, webp_path) if path.exists()]
    if existing and not args.overwrite:
        names = ", ".join(str(path) for path in existing)
        raise FileExistsError(f"拒绝覆盖已有输出文件：{names}")

    with Image.open(source) as image:
        source_image = image.convert("RGBA")
    frames = create_gif(source_image, args.scale, gif_path)
    quality = create_webp(frames, webp_path)
    canvas_w, canvas_h = frames[0].size

    print(f"GIF：{gif_path}（{gif_path.stat().st_size} 字节）")
    print(f"WebP：{webp_path}（{webp_path.stat().st_size} 字节；质量 {quality}）")
    print(f"画布：{canvas_w}x{canvas_h}；时长：{DURATION_SECONDS} 秒；循环：无限")
    if gif_path.stat().st_size > TARGET_BYTES or webp_path.stat().st_size > TARGET_BYTES:
        print("警告：在不缩小或裁切画面的前提下，部分输出仍超过 3 MiB 目标。", file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, FileExistsError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print(f"错误：{error}", file=sys.stderr)
        raise SystemExit(1)
