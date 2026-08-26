# Tessera

A color library that lives in your browser. Save colors and gradients, then find them
again by describing them — `neon`, `ocean`, `moody teal` — instead of remembering hex codes.

No account, no backend, no network calls. Your library is stored in your own browser and
never leaves your machine.

## Demo
[
Every visitor gets their own private library — the deployed page has no shared state.](https://alexander-288.github.io/Tessera/)

## Features

**Search by vibe.** Tessera builds a searchable vocabulary for every color you save. A hex
like `#00E5FF` is automatically described as *teal, cyan, aqua, cool, neon, vivid, bright*,
so searching `cool` finds it without you ever tagging it. A small synonym graph relates
concepts to each other — searching `cyberpunk` also surfaces things tagged `synthwave`,
`neon`, `magenta`, and `electric`. Matching is fuzzy and subsequence-based, so `syntwv`
still finds `synthwave`.

**Paste color in almost any notation.** Input is parsed through the browser's own CSS
parser, so named colors, `rgb()`, `hsl()`, `hwb()`, `lab()`, and `oklch()` all work, plus
hex in 3/4/6/8-digit form. `hsb()`/`hsv()` and `cmyk()` are handled separately since CSS
doesn't know them. Bare `255,0,85` works too. Everything is normalized to hex; alpha is
dropped.

**Stepped or smooth.** Multi-color items render as hard-edged bands or as a linear
gradient, toggled per item.

**Neighbors.** Each item's detail view shows the nearest colors in your library by
perceptual distance (redmean approximation), alongside items sharing its keywords.

**Values.** Every color is shown in Hex, RGB, HSL, HSB, and CMYK, each row click-to-copy.
Multi-color items additionally expose the ready-made CSS gradient, a comma-separated list,
and a JSON array.

**Export / import.** Export copies your whole library to the clipboard as JSON. Import
takes it back, skipping any item whose color set you already have.

## Keyboard

| Key | Action |
| --- | --- |
| `/` | Jump to add mode from anywhere |
| `Enter` | Advance to the next field |
| `Ctrl` / `Cmd` + `Enter` | Save immediately from the color field |
| `Esc` | Cancel the entry, close the editor, or return to the library |

## Running it

The repo has two copies of the same app.

**Split version** (repo root) — `index.html` + `css/styles.css` + `js/app.js`. Because it
loads external files, it must be served over HTTP; opening it via `file://` will trip CORS
in most browsers.

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

**Compact version** (`compact/tessera.html`) — the entire app as one self-contained file,
no server needed. Double-click it, or drop it on a USB stick. It is functionally identical
to the split version; the split was a pure extraction with no code changes.

## Structure

```
index.html             markup only
css/styles.css         all styling
js/app.js              all behavior
compact/tessera.html   single-file build of the same app
```

There is no build step, no dependencies, and no package manager. Editing the split files
does not regenerate the compact one — if you change the app and want both to stay in sync,
inline `styles.css` into a `<style>` block and `app.js` into a `<script>` block.

## Storage

Data is written to `localStorage` under the key `tessera.items` as a JSON array. Each item
looks like:

```json
{
  "id": "mt9tnbzvny37x",
  "name": "",
  "colors": ["#FF0055", "#00E5FF"],
  "type": "stepped",
  "tags": [],
  "date_added": "2026-08-26T08:18:10.939Z"
}
```

Clearing site data clears your library, so export before you do. If `localStorage` is
unavailable the app degrades to in-memory storage for the session rather than breaking.

## Browser support

Needs a current browser. Color parsing leans on `<canvas>` and whatever CSS color syntax
that browser understands, so exotic notations like `oklch()` resolve on newer engines and
are simply rejected as invalid on older ones.

## License

MIT — see [LICENSE](LICENSE).
