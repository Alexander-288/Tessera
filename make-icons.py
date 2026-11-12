#!/usr/bin/env python3
"""Build the Tessera mark and its icons from one piece of geometry.

The mark is a pile of three tesserae with a fourth sliding off the top. Every
tile is the same parallelogram, sheared 2:1 like the rest of the family's
marks, and the four carry a violet-to-amber ramp.

Writes:
    mark.svg      the mark on its own, transparent ground (used in the header)
    icon.svg      the same mark centred on a square paper ground
    favicon.ico   16/32/48/64px, drawn per size

    python make-icons.py

Only favicon.ico needs Pillow; the two SVGs are written either way.
"""
import pathlib
import struct

ROOT = pathlib.Path(__file__).parent

# ---- geometry -------------------------------------------------------------
TILE_W, TILE_H = 196, 100   # one tessera, before the shear
LEAN = 0.5                  # x shifts half a unit for every unit of height
GAP = 22                    # between tiles in the pile
SLIDE = 128                 # how far the loose tessera has slid sideways
LIFT = 27                   # and how far clear of the pile it sits

W = TILE_W + LEAN * TILE_H + SLIDE          # 374
H = 3 * TILE_H + 2 * GAP + TILE_H + LIFT    # 471
SQUARE = round(max(W, H) * 1.18)
OFFSET = ((SQUARE - W) / 2, (SQUARE - H) / 2)

PAPER = "#FFFFFF"
# bottom of the pile upwards, the loose tessera last
COLOURS = ["#3B1D7A", "#7C3AED", "#D946AA", "#FFB357"]


def tile(x, y):
    """One tessera with its top-left at (x, y)."""
    k = LEAN * TILE_H
    return [(x, y), (x + TILE_W, y), (x + TILE_W - k, y + TILE_H), (x - k, y + TILE_H)]


def tiles():
    """The four tesserae, bottom of the pile first, with their colours."""
    k = LEAN * TILE_H
    out = []
    for i in range(3):                                  # pile, bottom upwards
        out.append((tile(k, H - TILE_H - i * (TILE_H + GAP)), COLOURS[i]))
    out.append((tile(k + SLIDE, 0), COLOURS[3]))        # the loose one
    return out


def svg(square=False):
    ox, oy = OFFSET if square else (0, 0)
    box = ("%g %g %g %g" % (-ox, -oy, SQUARE, SQUARE)) if square else ("0 0 %g %g" % (W, H))
    ground = ('<rect x="%g" y="%g" width="%g" height="%g" fill="%s"/>'
              % (-ox, -oy, SQUARE, SQUARE, PAPER)) if square else ""
    shapes = "".join(
        '<path fill="%s" d="M%s Z"/>' % (c, " ".join("%g %g" % p for p in poly))
        for poly, c in tiles())
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s" role="img" aria-label="Tessera">\n'
            '  <title>Tessera</title>\n'
            '  %s\n'
            '  %s\n'
            '</svg>\n' % (box, ground, shapes))


# ---- favicon --------------------------------------------------------------
SS = 8      # drawn this much larger, then resized: keeps the diagonals smooth


def render(n):
    from PIL import Image
    from PIL import ImageDraw
    ox, oy = OFFSET
    s = n * SS / SQUARE
    big = Image.new("RGB", (n * SS, n * SS), (255, 255, 255))
    d = ImageDraw.Draw(big)
    for poly, c in tiles():
        d.polygon([((x + ox) * s, (y + oy) * s) for x, y in poly], fill=c)
    out = big.resize((n, n), Image.LANCZOS).convert("RGBA")
    return out


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


def write_ico(sizes=(16, 32, 48, 64)):
    frames = [(n, render(n)) for n in sizes]
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

    (ROOT / "favicon.ico").write_bytes(bytes(out))


def main():
    (ROOT / "mark.svg").write_text(svg(), encoding="utf-8", newline="\n")
    (ROOT / "icon.svg").write_text(svg(square=True), encoding="utf-8", newline="\n")
    print("wrote mark.svg (%g x %g) and icon.svg (%d square)" % (W, H, SQUARE))
    try:
        write_ico()
    except ImportError:
        print("skipped favicon.ico: Pillow is not installed")
    else:
        print("wrote favicon.ico (%d bytes)" % (ROOT / "favicon.ico").stat().st_size)


if __name__ == "__main__":
    main()
