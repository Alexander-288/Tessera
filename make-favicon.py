#!/usr/bin/env python3
"""Render favicon.ico from the same tile geometry as icon.svg.

Drawn per size on the pixel grid rather than rasterized from the SVG, so the
1px rules stay crisp at 16px instead of turning into grey mush.

    python make-favicon.py
"""
import pathlib
import struct

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).parent
OUT = ROOT / "favicon.ico"

INK = (0, 0, 0, 255)
PAPER = (255, 255, 255, 255)   # opaque: keeps it legible on dark tab bars too

# Four tesserae on a 2x2 grid, sheared 2:1 like the rest of the brand marks.
# Units match icon.svg: a 152 square with the 150x100 mark at (1, 26).
BOX = 152.0
ORIGIN = (1.0, 26.0)
TILE = 43.0
STEP = 57.0        # tile + gap
LEAN = 0.5         # x shifts half a unit for every unit of height
SIZES = (16, 32, 48, 64)


def tile_points(row, col):
    """The parallelogram for one tessera, in icon.svg units."""
    y = row * STEP
    x = col * STEP + LEAN * (100.0 - y)
    return [(x, y), (x + TILE, y),
            (x + TILE - LEAN * TILE, y + TILE), (x - LEAN * TILE, y + TILE)]


def lone_tessera(n):
    """At 16px the full grid turns to mush, so the tab gets one inked tile."""
    img = Image.new("RGBA", (n, n), PAPER)
    t = round((n - 2) / 1.5)
    x, y = (n - t * 1.5) / 2 + t * LEAN, (n - t) / 2
    ImageDraw.Draw(img).polygon(
        [(x, y), (x + t, y), (x + t - t * LEAN, y + t), (x - t * LEAN, y + t)], fill=INK)
    return img


def render(n):
    if n < 24:
        return lone_tessera(n)
    s = n / BOX
    img = Image.new("RGBA", (n, n), PAPER)
    d = ImageDraw.Draw(img)
    for row in range(2):
        for col in range(2):
            pts = [((ORIGIN[0] + x) * s, (ORIGIN[1] + y) * s)
                   for x, y in tile_points(row, col)]
            filled = row == 0 and col == 0    # one inked tessera
            d.polygon(pts, fill=INK if filled else None, outline=INK)
    return img


def bmp_entry(img):
    """One ICO image as a 32bpp BMP: header, bottom-up BGRA, then the AND mask.

    Written by hand because PIL's ICO writer downsamples a single source image
    to every requested size, which would throw away the per-size rendering.
    """
    w, h = img.size
    px = img.load()

    header = struct.pack("<IiiHHIIiiII",
                         40,        # header size
                         w, h * 2,  # height is doubled: colour data + AND mask
                         1, 32,     # planes, bits per pixel
                         0, 0,      # BI_RGB, image size (0 is legal uncompressed)
                         0, 0, 0, 0)

    rows = []
    for y in range(h - 1, -1, -1):            # BMP rows run bottom-up
        row = bytearray()
        for x in range(w):
            r, g, b, a = px[x, y]
            row += bytes((b, g, r, a))        # BGRA
        rows.append(bytes(row))

    # Fully opaque, so the 1bpp mask is all zeros, each row padded to 4 bytes.
    mask_row = ((w + 31) // 32) * 4
    mask = bytes(mask_row * h)          # bytes(n) is n zero bytes

    return header + b"".join(rows) + mask


def main():
    frames = [(n, render(n)) for n in SIZES]
    blobs = [bmp_entry(img) for _, img in frames]

    offset = 6 + 16 * len(blobs)
    out = bytearray(struct.pack("<HHH", 0, 1, len(blobs)))     # ICONDIR
    for (n, _), blob in zip(frames, blobs):
        out += struct.pack("<BBBBHHII",
                           n if n < 256 else 0, n if n < 256 else 0,
                           0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
    for blob in blobs:
        out += blob

    OUT.write_bytes(bytes(out))
    print("wrote %s (%d bytes, sizes %s)"
          % (OUT.name, OUT.stat().st_size, ", ".join(str(n) for n in SIZES)))


if __name__ == "__main__":
    main()
