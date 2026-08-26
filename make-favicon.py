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

# In a 16-unit grid: four tiles at 0 and 9, each 7 across, 2 apart.
ORIGINS = (0, 9)
TILE = 7
SIZES = (16, 32, 48, 64)


def render(n):
    s = n / 16
    img = Image.new("RGBA", (n, n), PAPER)
    d = ImageDraw.Draw(img)
    w = max(1, round(s))                      # stroke scales with the icon
    for row, y in enumerate(ORIGINS):
        for col, x in enumerate(ORIGINS):
            box = [round(x * s), round(y * s),
                   round((x + TILE) * s) - 1, round((y + TILE) * s) - 1]
            filled = row == 0 and col == 0    # one inked tessera
            d.rectangle(box, fill=INK if filled else None, outline=INK, width=w)
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
