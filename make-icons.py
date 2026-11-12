#!/usr/bin/env python3
"""Build the Tessera mark and its icons from one piece of geometry.

Writes:
    mark.svg      the mark on its own, 3:2, transparent ground (used in the header)
    icon.svg      the same mark centred on a square paper ground
    favicon.ico   16/32/48/64px; under 48px the grout is dropped so it stays readable

    python make-icons.py

Only favicon.ico needs Pillow; the two SVGs are written either way.
"""
import pathlib
import struct

ROOT = pathlib.Path(__file__).parent

# ---- geometry -------------------------------------------------------------
# A T drawn like the other marks in the family: every cut runs 2:1, the stem
# leans with it, and the bar is as deep as the arms on the fold mark.
W, H = 530.0, 353.0
LEAN = 0.5      # x shifts half a unit for every unit of height
BAR = 88.0      # depth of the top bar
STEM = 110.0    # thickness of the stem
CELL = 59.0     # tessera pitch
GROUT = 6.0     # gap between tesserae

SQUARE = 616.0  # square icon canvas, leaves the mark a margin to breathe
OFFSET = ((SQUARE - W) / 2, (SQUARE - H) / 2)

PAPER = "#FFFFFF"
# Indigo through the brand periwinkle to warm sand, read along the 2:1 diagonal.
STOPS = [(0.00, (36, 24, 160)), (0.30, (108, 91, 255)), (0.55, (150, 150, 255)),
         (0.80, (255, 122, 168)), (1.00, (255, 159, 74))]


def outline():
    """The T as a closed polygon, clockwise from the top-left of the bar."""
    bar_top, bar_bottom = LEAN * BAR, 0.0
    right_bottom = W - LEAN * BAR
    centre = right_bottom / 2
    left, right = centre - STEM / 2, centre + STEM / 2
    drop = H - BAR
    return [(bar_top, 0.0), (W, 0.0), (right_bottom, BAR), (right, BAR),
            (right - LEAN * drop, H), (left - LEAN * drop, H), (left, BAR),
            (bar_bottom, BAR)]


def ramp(t):
    t = max(0.0, min(1.0, t))
    for (a, ca), (b, cb) in zip(STOPS, STOPS[1:]):
        if t <= b:
            u = 0.0 if b == a else (t - a) / (b - a)
            return tuple(round(ca[i] + (cb[i] - ca[i]) * u) for i in range(3))
    return STOPS[-1][1]


def axis(x, y):
    """Where a point sits along the gradient, read along the 2:1 diagonal."""
    return (x / W) * 0.62 + (1 - y / H) * 0.38


def _inside(poly, x, y):
    hit = False
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % len(poly)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def _found():
    """Tesserae that carry ink, with their raw position along the ramp.

    The ramp is stretched across the tiles that exist rather than across the
    bounding box, so both ends of it actually show up in the mark.
    """
    poly = outline()
    found = []
    y = 0.0
    while y < H:
        x = 0.0
        while x < W:
            w, h = min(CELL - GROUT, W - x), min(CELL - GROUT, H - y)
            # a tile counts if any of its corners or its centre land on the T
            pts = [(x + w / 2, y + h / 2), (x + 1, y + 1), (x + w - 1, y + 1),
                   (x + 1, y + h - 1), (x + w - 1, y + h - 1)]
            if any(_inside(poly, px, py) for px, py in pts):
                found.append([x, y, w, h, axis(x + w / 2, y + h / 2)])
            x += CELL
        y += CELL
    return found


def tiles():
    """Tesserae with their colours, the ramp stretched across the ones that exist."""
    found = _found()
    lo, hi = ramp_span()
    return [(x, y, w, h, "#%02X%02X%02X" % ramp((t - lo) / (hi - lo)))
            for x, y, w, h, t in found]


def ramp_span():
    """The stretch of the gradient the mark actually covers."""
    vals = [t[4] for t in _found()]
    return min(vals), max(vals)


def path_d():
    pts = outline()
    return "M" + " ".join("%g %g" % p for p in pts) + "Z"


def svg(square=False):
    ox, oy = OFFSET
    box = "%g %g %g %g" % (-ox, -oy, SQUARE, SQUARE) if square else "0 0 %g %g" % (W, H)
    ground = ('<rect x="%g" y="%g" width="%g" height="%g" fill="%s"/>'
              % (-ox, -oy, SQUARE, SQUARE, PAPER)) if square else ""
    rects = "".join('<rect x="%g" y="%g" width="%g" height="%g" fill="%s"/>' % t for t in tiles())
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s" role="img" aria-label="Tessera">\n'
        '  <title>Tessera</title>\n'
        '  %s\n'
        '  <defs><clipPath id="t"><path d="%s"/></clipPath></defs>\n'
        '  <g clip-path="url(#t)">%s</g>\n'
        '</svg>\n' % (box, ground, path_d(), rects))


# ---- favicon --------------------------------------------------------------

def render(n):
    """One favicon size.

    The tesserae are dropped here: at 64px and under each one is a couple of
    pixels wide and the grout eats the letter, so the ico carries the same
    ramp as a smooth fill. The tiles live in mark.svg and icon.svg.
    """
    from PIL import Image, ImageDraw
    ox, oy = OFFSET
    s = n / SQUARE
    img = Image.new("RGBA", (n, n), (255, 255, 255, 255))
    shape = Image.new("L", (n, n), 0)
    ImageDraw.Draw(shape).polygon([((x + ox) * s, (y + oy) * s) for x, y in outline()], fill=255)

    lo, hi = ramp_span()
    ink = Image.new("RGBA", (n, n))
    px = ink.load()
    for iy in range(n):
        for ix in range(n):
            x, y = ix / s - ox, iy / s - oy
            t = (axis(x, y) - lo) / (hi - lo)
            px[ix, iy] = ramp(t) + (255,)
    img.paste(ink, (0, 0), shape)
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
    print("wrote mark.svg and icon.svg (%d tesserae)" % len(tiles()))
    try:
        write_ico()
    except ImportError:
        print("skipped favicon.ico: Pillow is not installed")
    else:
        print("wrote favicon.ico (%d bytes)" % (ROOT / "favicon.ico").stat().st_size)


if __name__ == "__main__":
    main()
