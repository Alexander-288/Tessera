#!/usr/bin/env python3
"""Inline index.html + css/styles.css + js/app.js into compact/tessera.html.

The compact build is the same app as a single self-contained file that runs
straight from disk with no server. Run this after changing the split sources
so the two cannot drift apart.

    python build-compact.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / "index.html"
CSS = ROOT / "css" / "styles.css"
JS = ROOT / "js" / "app.js"
OUT = ROOT / "compact" / "tessera.html"

LINK = '<link rel="stylesheet" href="css/styles.css">'
SCRIPT = '<script src="js/app.js"></script>'


def read(p):
    if not p.exists():
        sys.exit("missing source file: %s" % p)
    return p.read_text(encoding="utf-8")


def main():
    html, css, js = read(SRC), read(CSS), read(JS)

    for needle in (LINK, SCRIPT):
        if needle not in html:
            sys.exit("index.html no longer contains %s \u2014 update build-compact.py" % needle)

    # A literal </script> inside the JS would close the tag early. None exists
    # today, but escape defensively so a future string literal cannot break it.
    js = js.replace("</script>", "<\/script>")

    html = html.replace(LINK, "<style>\n%s\n</style>" % css.strip())
    html = html.replace(SCRIPT, "<script>\n%s\n</script>" % js.strip())

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html, encoding="utf-8", newline="\n")

    # Sanity: nothing should still point at the external files.
    leftover = re.findall(r'(?:href|src)="(?:css|js)/[^"]+"', html)
    if leftover:
        sys.exit("external references survived inlining: %s" % leftover)

    print("wrote %s (%.1f KB)" % (OUT.relative_to(ROOT), OUT.stat().st_size / 1024))


if __name__ == "__main__":
    main()
