"""Render the Health Risk symptom glyphs from the approved masters.

Each scale (24, 48 and 72 px on the shared 24-unit icon box) is resampled
directly from its 1254 px master, never from a smaller export. The masters in
originals/ are the founder-approved bytes and are never modified; mapping.json
pins each one by SHA-256 and names the exact symptom string it stands for.

One size rule for the whole set, so the glyphs read as one family even though
the masters carry different amounts of empty canvas (the corrected Fever
master, for one, fills far more of its canvas than the others):

  - the artwork's bounds are measured on the master (alpha > 50%), ignoring
    the near-transparent generation haze, which is cleared (alpha < 4%);
  - the artwork is scaled so that sqrt(width x height) is AREA_UNITS grid
    units, unless that would make its longer side exceed MAX_UNITS — the same
    22-unit envelope the Lucide glyphs fill — in which case the longer side
    is MAX_UNITS;
  - it is centred in the 24-unit box and written as navy (#001F3E) on
    transparent, like the rest of assets/icons; the app tints it at runtime.

Requires Pillow and NumPy. Run from the repository root:

    python3 assets/icon-sources/symptoms/render.py
"""

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
SOURCES = Path(__file__).resolve().parent
OUT = ROOT / 'assets' / 'icons'

BOX_UNITS = 24
AREA_UNITS = 20.0
MAX_UNITS = 22.0
HAZE = 0.04
NAVY = (0x00, 0x1F, 0x3E)


def render(master: Path, slug: str) -> dict:
    alpha = np.asarray(Image.open(master).convert('RGBA'), dtype=np.float64)[..., 3] / 255.0
    alpha[alpha < HAZE] = 0.0
    ys, xs = np.where(alpha > 0.5)
    left, top, right, bottom = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    width, height = right - left, bottom - top
    units_per_px = min(AREA_UNITS / np.sqrt(width * height), MAX_UNITS / max(width, height))
    # The square of master pixels that maps onto the 24-unit box, centred on
    # the artwork, padded with transparency where it overhangs the canvas.
    side = BOX_UNITS / units_per_px
    cx, cy = (left + right) / 2, (top + bottom) / 2
    x0, y0 = cx - side / 2, cy - side / 2
    pad = int(np.ceil(side))
    canvas = np.zeros((alpha.shape[0] + 2 * pad, alpha.shape[1] + 2 * pad))
    canvas[pad : pad + alpha.shape[0], pad : pad + alpha.shape[1]] = alpha
    source = Image.fromarray(canvas.astype(np.float32))
    box = (x0 + pad, y0 + pad, x0 + pad + side, y0 + pad + side)
    files = []
    for scale in (1, 2, 3):
        px = BOX_UNITS * scale
        a = np.asarray(source.resize((px, px), Image.Resampling.LANCZOS, box=box))
        a = np.clip(np.rint(a * 255.0), 0, 255).astype(np.uint8)
        rgba = np.zeros((px, px, 4), dtype=np.uint8)
        rgba[..., 0], rgba[..., 1], rgba[..., 2] = NAVY
        rgba[..., 3] = a
        suffix = '' if scale == 1 else f'@{scale}x'
        path = OUT / f'symptom-{slug}{suffix}.png'
        Image.fromarray(rgba).save(path, optimize=True)
        files.append(
            {
                'path': str(path.relative_to(ROOT)),
                'px': px,
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            }
        )
    return {
        'masterBounds': [int(left), int(top), int(width), int(height)],
        'artworkUnits': [round(width * units_per_px, 2), round(height * units_per_px, 2)],
        'files': files,
    }


def main() -> None:
    mapping = json.loads((SOURCES / 'mapping.json').read_text())
    report = []
    for entry in mapping:
        master = SOURCES / entry['file']
        digest = hashlib.sha256(master.read_bytes()).hexdigest()
        if digest != entry['sha256']:
            raise SystemExit(f'{master.name}: not the approved bytes')
        report.append({'label': entry['label'], 'slug': entry['slug'], **render(master, entry['slug'])})
    (SOURCES / 'render-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'rendered {len(report)} glyphs x 3 scales')


if __name__ == '__main__':
    main()
