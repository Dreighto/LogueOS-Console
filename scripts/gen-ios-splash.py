#!/usr/bin/env python3
"""
gen-ios-splash.py — generate iOS PWA launch splash screens.

iOS Safari needs apple-touch-startup-image link tags with exact pixel
dimensions for each iPhone screen size. Without them, the PWA launches
to a blank white flash; with them, you get a branded loading screen.

This script renders one splash per current-and-recent iPhone size,
centering the LogueOS logo on the theme color (#0d1117). Run after any
logo change.

Output: static/ios/splash-<W>x<H>.png
Sizes target iPhone X (2017) and later — the relevant population for an
operator running iOS 16+.
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
LOGO_PATH = ROOT / "static" / "los_logo.png"
OUT_DIR = ROOT / "static" / "ios"
BG_HEX = "#0d1117"

# Portrait dimensions (W, H) for iPhone X through 16 Pro Max.
# Sourced from Apple's HIG + iPhone screen-size spec sheets. The tags in
# app.html will key each splash to its specific media query.
SIZES = [
    # iPhone SE (2nd/3rd gen), iPhone 8, iPhone 7, iPhone 6/6s — 4.7" 750x1334
    (750, 1334),
    # iPhone 8 Plus / 7 Plus / 6 Plus — 5.5"
    (1242, 2208),
    # iPhone X / XS / 11 Pro — 5.8"
    (1125, 2436),
    # iPhone XR / 11 — 6.1" (low-density)
    (828, 1792),
    # iPhone XS Max / 11 Pro Max — 6.5"
    (1242, 2688),
    # iPhone 12 mini / 13 mini — 5.4"
    (1080, 2340),
    # iPhone 12 / 12 Pro / 13 / 13 Pro / 14 — 6.1"
    (1170, 2532),
    # iPhone 14 Plus / 13 Pro Max / 12 Pro Max — 6.7"
    (1284, 2778),
    # iPhone 14 Pro / 15 / 15 Pro / 16 — 6.1" with Dynamic Island
    (1179, 2556),
    # iPhone 14 Pro Max / 15 Plus / 15 Pro Max / 16 Plus — 6.7" with Dynamic Island
    (1290, 2796),
    # iPhone 16 Pro — 6.3"
    (1206, 2622),
    # iPhone 16 Pro Max — 6.9"
    (1320, 2868),
]


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def render_splash(w: int, h: int, logo: Image.Image, bg: tuple[int, int, int]) -> Image.Image:
    canvas = Image.new("RGB", (w, h), bg)
    # Logo at ~28% of the shorter dimension — feels right on phones.
    target = int(min(w, h) * 0.28)
    aspect = logo.width / logo.height
    if aspect >= 1:
        lw, lh = target, int(target / aspect)
    else:
        lw, lh = int(target * aspect), target
    logo_scaled = logo.resize((lw, lh), Image.Resampling.LANCZOS)
    pos = ((w - lw) // 2, (h - lh) // 2)
    if logo_scaled.mode in ("RGBA", "LA"):
        canvas.paste(logo_scaled, pos, mask=logo_scaled)
    else:
        canvas.paste(logo_scaled, pos)
    return canvas


def main() -> None:
    if not LOGO_PATH.exists():
        raise SystemExit(f"logo not found at {LOGO_PATH}")
    logo = Image.open(LOGO_PATH)
    bg = hex_to_rgb(BG_HEX)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for w, h in SIZES:
        out_path = OUT_DIR / f"splash-{w}x{h}.png"
        img = render_splash(w, h, logo, bg)
        img.save(out_path, "PNG", optimize=True)
        print(f"  → {out_path.relative_to(ROOT)} ({w}x{h})")
    print(f"\nWrote {len(SIZES)} splash screens.")


if __name__ == "__main__":
    main()
