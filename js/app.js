"use strict";

/* ===== storage ===== */
const KEY = "tessera.items";
const store = (() => {
  try {
    const t = "__tessera__";
    localStorage.setItem(t, "1"); localStorage.removeItem(t);
    return { load: async () => JSON.parse(localStorage.getItem(KEY) || "[]"),
             save: async v => localStorage.setItem(KEY, JSON.stringify(v)) };
  } catch (e) {}
  if (window.storage) {
    return { load: async () => { try { const r = await window.storage.get(KEY); return r ? JSON.parse(r.value) : []; } catch { return []; } },
             save: async v => { try { await window.storage.set(KEY, JSON.stringify(v)); } catch {} } };
  }
  let mem = [];
  return { load: async () => mem, save: async v => { mem = v; } };
})();

let items = [], mode = "search", entryType = "stepped", editType = "stepped", openId = null;

/* Display order is shuffled and lives only in memory — the stored order in
   `items` is never touched, so export/import stay stable and reproducible. */
let order = new Map();
const reshuffle = () => { order = new Map(items.map(i => [i.id, Math.random()])); };
/* An id with no key yet is one just added or imported: float it to the front so
   you actually see what you saved instead of it landing somewhere random. */
const orderKey = i => order.has(i.id) ? order.get(i.id) : -1;

/* ===== color math ===== */
/* --- input parsing: hex, any CSS color the browser knows, plus HSB and CMYK --- */
const _cv = document.createElement("canvas");
_cv.width = _cv.height = 1;
const _ctx = _cv.getContext("2d", { willReadFrequently: true });
const toHex = (r,g,b) => "#" + [r,g,b].map(v =>
  Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2,"0")).join("").toUpperCase();

/* let the browser's own parser decide: named colors, rgb, hsl, hwb, lab, oklch, color() */
function cssToHex(tok){
  try {
    _ctx.fillStyle = "#010203";
    _ctx.fillStyle = tok;
    const v = _ctx.fillStyle;
    if (v === "#010203") return null;                       // rejected, unchanged
    let m = /^#([0-9a-f]{6})$/i.exec(v);
    if (m) return ("#" + m[1]).toUpperCase();
    m = /^rgba?\(([^)]+)\)$/i.exec(v);
    if (m){ const n = m[1].split(",").map(parseFloat); return toHex(n[0], n[1], n[2]); }
    _ctx.clearRect(0,0,1,1); _ctx.fillRect(0,0,1,1);        // exotic syntax: read the pixel
    const d = _ctx.getImageData(0,0,1,1).data;
    return d[3] === 0 ? null : toHex(d[0], d[1], d[2]);
  } catch { return null; }
}
function hsbToHex(h, s, v){
  h = ((h % 360) + 360) % 360; s = Math.min(100, Math.max(0, s))/100; v = Math.min(100, Math.max(0, v))/100;
  const c = v*s, x = c*(1 - Math.abs((h/60)%2 - 1)), m = v - c;
  const p = h < 60 ? [c,x,0] : h < 120 ? [x,c,0] : h < 180 ? [0,c,x]
          : h < 240 ? [0,x,c] : h < 300 ? [x,0,c] : [c,0,x];
  return toHex((p[0]+m)*255, (p[1]+m)*255, (p[2]+m)*255);
}
function cmykToHex(c, m, y, k){
  [c,m,y,k] = [c,m,y,k].map(v => Math.min(100, Math.max(0, v))/100);
  return toHex(255*(1-c)*(1-k), 255*(1-m)*(1-k), 255*(1-y)*(1-k));
}
function oneColor(tok){
  tok = tok.trim();
  if (!tok) return null;
  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(tok);
  if (hex){
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.slice(0,3).split("").map(c => c+c).join("");
    return ("#" + h.slice(0,6)).toUpperCase();              // alpha dropped
  }
  const fn = /^([a-z]+)\s*\(\s*([^()]*)\)$/i.exec(tok);
  if (fn){
    const kind = fn[1].toLowerCase();
    const n = fn[2].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    if (kind === "cmyk" && n.length >= 4) return cmykToHex(n[0], n[1], n[2], n[3]);
    if ((kind === "hsb" || kind === "hsv") && n.length >= 3) return hsbToHex(n[0], n[1], n[2]);
  }
  return cssToHex(tok);
}
function parseColors(raw){
  const held = [];
  const stash = m => { held.push(m); return " \u0000" + (held.length - 1) + "\u0000 "; };  // keep the slot
  let rest = String(raw)
    .replace(/[a-z]+\s*\(\s*[^()]*\)/gi, stash)                                   // keep fn() whole
    .replace(/(\d{1,3}(?:\.\d+)?)\s*,\s*(\d{1,3}(?:\.\d+)?)\s*,\s*(\d{1,3}(?:\.\d+)?)/g,
      (m,a,b,c) => stash(`rgb(${a},${b},${c})`));                                 // bare 255,0,85
  const seen = new Set();
  return rest.split(/[\s,;|]+/).filter(Boolean)
    .map(t => { const h = /^\u0000(\d+)\u0000$/.exec(t); return h ? held[+h[1]] : t; })
    .map(oneColor)
    .filter(c => c && !seen.has(c) && seen.add(c));   // no color twice in one item
}
const rgb = hex => [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
function hsl(hex){
  const [R,G,B] = rgb(hex).map(v => v/255);
  const max = Math.max(R,G,B), min = Math.min(R,G,B), d = max-min, l = (max+min)/2;
  let h = 0, s = 0;
  if (d){
    s = d / (1 - Math.abs(2*l - 1));
    h = max === R ? ((G-B)/d)%6 : max === G ? (B-R)/d + 2 : (R-G)/d + 4;
    h = (h*60 + 360) % 360;
  }
  return [Math.round(h), Math.round(s*100), Math.round(l*100)];
}
function hsv(hex){
  const [R,G,B] = rgb(hex).map(v => v/255);
  const max = Math.max(R,G,B), min = Math.min(R,G,B), d = max-min;
  let h = 0;
  if (d){
    h = max === R ? ((G-B)/d)%6 : max === G ? (B-R)/d + 2 : (R-G)/d + 4;
    h = (h*60 + 360) % 360;
  }
  return [Math.round(h), Math.round((max ? d/max : 0)*100), Math.round(max*100)];
}
function cmyk(hex){
  const [R,G,B] = rgb(hex).map(v => v/255);
  const k = 1 - Math.max(R,G,B);
  if (k === 1) return [0,0,0,100];
  return [((1-R-k)/(1-k)*100), ((1-G-k)/(1-k)*100), ((1-B-k)/(1-k)*100), k*100].map(Math.round);
}
/* perceptual-ish distance (redmean), 0 = identical */
function dist(a, b){
  const [r1,g1,b1] = rgb(a), [r2,g2,b2] = rgb(b);
  const rm = (r1+r2)/2, dr = r1-r2, dg = g1-g2, db = b1-b2;
  return Math.sqrt((2 + rm/256)*dr*dr + 4*dg*dg + (2 + (255-rm)/256)*db*db);
}
const itemDist = (a, b) => Math.min(...a.colors.flatMap(x => b.colors.map(y => dist(x,y))));

function background(colors, type){
  if (colors.length === 1) return colors[0];
  if (type === "smooth") return "linear-gradient(135deg," + colors.join(",") + ")";
  const step = 100 / colors.length;
  return "linear-gradient(90deg," + colors.map((c,i) =>
    `${c} ${(i*step).toFixed(4)}% ${((i+1)*step).toFixed(4)}%`).join(",") + ")";
}
function copyValue(item){
  if (item.type === "single") return item.colors[0];
  if (item.type === "smooth") return background(item.colors, "smooth");
  return item.colors.join(", ");
}
const TAPER = Math.LN2, WMAX = 2.2;
const boxWidth = n => n <= 1 ? 1 : 1 + (WMAX - 1) * (1 - Math.exp(-TAPER * (n - 1)));
function paintBox(el, colors, type){
  el.classList.toggle("empty", colors.length === 0);
  el.style.setProperty("--w", boxWidth(colors.length).toFixed(3));
  el.style.background = colors.length ? background(colors, type) : "";
}
const signature = colors => colors.join("");   // identity of an item's color set

/* ===== vocabulary ===== */
function hexName(hex){
  const [h,s,l] = hsl(hex), out = [];
  if (l > 92) out.push("white","light","pale");
  else if (l < 10) out.push("black","dark","deep");
  if (s < 12){ out.push("gray","grey","neutral","mono"); return out; }
  if (s > 72 && l > 42 && l < 70) out.push("neon","vivid","saturated","bright");
  if (l < 30) out.push("dark","deep","moody");
  if (l > 78) out.push("pastel","soft","light");
  if (h < 15 || h >= 345) out.push("red","crimson","warm");
  else if (h < 45) out.push("orange","amber","warm","sunset");
  else if (h < 70) out.push("yellow","gold","warm");
  else if (h < 160) out.push("green","lime","forest","natural");
  else if (h < 195) out.push("teal","cyan","aqua","cool");
  else if (h < 255) out.push("blue","azure","cool","ocean");
  else if (h < 290) out.push("purple","violet","indigo","cool");
  else out.push("pink","magenta","fuchsia");
  return out;
}
const VIBES = {
  ocean:["water","sea","blue","teal","aqua","marine","deep","wave"],
  water:["ocean","blue","aqua","teal","sea"],
  warm:["red","orange","amber","gold","yellow","sunset","fire","hot"],
  cool:["blue","cyan","teal","ice","cold","mint"],
  neon:["cyberpunk","cyber","electric","vivid","glow","synthwave","bright"],
  cyberpunk:["neon","synthwave","magenta","cyan","electric","night"],
  synthwave:["neon","retro","cyberpunk","magenta","purple","sunset"],
  retro:["vintage","synthwave","muted"],
  earth:["natural","brown","clay","sand","forest","green","organic"],
  nature:["earth","green","forest","natural","organic","leaf"],
  forest:["green","nature","earth","deep","moss"],
  pastel:["soft","light","pale","muted","calm"],
  calm:["pastel","soft","muted","cool","quiet"],
  aggressive:["neon","red","vivid","harsh","loud","bright"],
  moody:["dark","deep","night","muted"],
  night:["dark","deep","moody","black","midnight"],
  sunset:["orange","warm","pink","gold","dusk"],
  fire:["red","orange","warm","hot","ember"],
  ice:["cool","blue","white","cyan","frost"],
  mono:["gray","grey","black","white","neutral"]
};
function expand(token){
  const set = new Set([token]);
  (VIBES[token] || []).forEach(t => set.add(t));
  for (const [k,v] of Object.entries(VIBES)) if (v.includes(token)) set.add(k);
  return set;
}
function fuzzy(needle, hay){
  if (hay.includes(needle)) return true;
  if (needle.length < 3) return false;
  let i = 0;
  for (const ch of hay) if (ch === needle[i] && ++i === needle.length) return true;
  return false;
}
function haystack(item){
  const words = new Set();
  if (item.name) String(item.name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).forEach(w => words.add(w));
  item.tags.forEach(t => expand(t.toLowerCase()).forEach(w => words.add(w)));
  item.colors.forEach(c => { words.add(c.toLowerCase().slice(1)); hexName(c).forEach(w => words.add(w)); });
  words.add(item.type);
  return [...words];
}
function matches(item, query){
  const tokens = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = haystack(item);
  return tokens.every(tok => [...expand(tok)].some(t => hay.some(w => fuzzy(t, w))));
}

/* ===== dom ===== */
const $ = id => document.getElementById(id);
const cmd = $("cmd"), tags = $("tags"), nameIn = $("name"), grid = $("grid"), seg = $("seg"), box = $("box"),
      tray = $("tray"), consoleEl = $("console"), modeBtn = $("modeBtn"), modeIcon = $("modeIcon"),
      modeLabel = $("modeLabel"), statusEl = $("status"), blank = $("blank"),
      library = $("library"), detail = $("detail"), dbox = $("dbox"),
      eColors = $("eColors"), eTags = $("eTags"), eName = $("eName"), eSeg = $("eSeg"),
      displayMeta = $("displayMeta"), editMeta = $("editMeta"),
      editBtn = $("editBtn"), delBtn = $("delBtn"),
      typeBtn = $("typeBtn"), typeLabel = $("typeLabel");
const ICON = {
  search: '<circle cx="7" cy="7" r="4.4"/><line x1="10.2" y1="10.2" x2="14" y2="14"/>',
  add:    '<line x1="8" y1="2.5" x2="8" y2="13.5"/><line x1="2.5" y1="8" x2="13.5" y2="8"/>'
};

let statusTimer;
function say(msg){
  statusEl.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { statusEl.textContent = ""; }, 2800);
}
async function toClipboard(value, el){
  try { await navigator.clipboard.writeText(value); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = value; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch {}
    ta.remove();
  }
  if (el){ el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 170); }
  say("Copied " + value.slice(0, 36));
}

/* ===== add mode ===== */
function setMode(next, announce){
  mode = next;
  const add = next === "add";
  modeIcon.innerHTML = add ? ICON.add : ICON.search;
  modeIcon.classList.remove("in"); void modeIcon.offsetWidth; modeIcon.classList.add("in");
  modeBtn.setAttribute("aria-pressed", String(add));
  modeLabel.textContent = add ? "Switch to search mode" : "Switch to add mode";
  cmd.placeholder = add ? "#FF0055  hotpink  rgb(0,229,255)" : "Search by vibe, tag, or hex";
  cmd.setAttribute("aria-label", add ? "Colors in any CSS notation, separated by spaces" : "Search or add");
  $("hint").innerHTML = add ? 'Hex, names, rgb, hsl, hsb, cmyk. Enter saves.'
                            : 'Start with <kbd>/</kbd> to add a color instead.';
  consoleEl.dataset.mode = next;
  tray.setAttribute("aria-hidden", String(!add));
  tray.inert = !add;
  refreshEntry();
  render();
  if (announce) say(add ? "Add mode" : "Search mode");
}
function refreshEntry(){
  if (mode !== "add") return;
  const colors = parseColors(cmd.value);
  seg.classList.toggle("on", colors.length >= 2);
  paintBox(box, colors, entryType);
}

/* ===== library render ===== */
function render(){
  const q = mode === "search" ? cmd.value.trim() : "";
  const visible = items.filter(i => matches(i, q)).sort((a,b) => orderKey(a) - orderKey(b));
  grid.replaceChildren();

  visible.forEach(item => {
    const tile = document.createElement("div");
    tile.className = "tile";
    const sw = document.createElement("button");
    sw.className = "swatch";
    sw.type = "button";
    sw.style.background = background(item.colors, item.type);
    sw.setAttribute("aria-label", "Open " + (item.name ? item.name + ", " : "") + copyValue(item) + (item.tags.length ? ", tagged " + item.tags.join(", ") : ""));
    sw.addEventListener("click", () => open(item.id));

    const cap = document.createElement("div");
    cap.className = "caption";
    const hexLine = item.colors.length === 1 ? item.colors[0] : item.colors.length + "\u00D7 " + item.type;
    if (item.name){
      const n = document.createElement("span");
      n.className = "name";
      n.textContent = item.name;
      cap.appendChild(n);
    }
    cap.appendChild(document.createTextNode(hexLine));
    if (item.tags.length){
      const t = document.createElement("span");
      t.className = "tags";
      t.textContent = item.tags.join(", ");
      cap.appendChild(t);
    }
    tile.append(sw, cap);
    grid.appendChild(tile);
  });

  $("count").textContent = items.length + (items.length === 1 ? " item" : " items");
  $("shown").textContent = visible.length === items.length ? visible.length + " shown"
                                                           : visible.length + " of " + items.length;
  blank.hidden = visible.length > 0;
  blank.textContent = items.length === 0 ? "Nothing saved yet. Press / and paste a hex code."
                                         : "No match for \u201C" + q + "\u201D. Try a broader word.";
}

const persist = () => store.save(items);
const findBySignature = (sig, exceptId) => items.find(i => signature(i.colors) === sig && i.id !== exceptId);

async function add(){
  const colors = parseColors(cmd.value);
  if (!colors.length){ say("No valid hex found"); cmd.focus(); return; }
  const clash = findBySignature(signature(colors));
  if (clash){ say("Already saved \u2014 opening it"); cmd.value = ""; tags.value = ""; nameIn.value = ""; refreshEntry(); open(clash.id); return; }
  items.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,7),
    name: nameIn.value.trim(),
    colors,
    type: colors.length === 1 ? "single" : entryType,
    tags: tags.value.split(/[\s,]+/).map(t => t.trim().toLowerCase()).filter(Boolean),
    date_added: new Date().toISOString()
  });
  cmd.value = ""; tags.value = ""; nameIn.value = "";
  await persist(); refreshEntry(); render();
  say("Saved " + colors[0] + (colors.length > 1 ? " +" + (colors.length - 1) : ""));
  cmd.focus();
}

/* ===== navigation =====
   pushState throws in an about:srcdoc frame (preview), so probe once and
   fall back to plain in-page switching when the URL can't be touched. */
const CAN_HISTORY = (() => {
  try { history.replaceState(history.state, "", location.href); return true; }
  catch { return false; }
})();
function pushRoute(id){
  if (!CAN_HISTORY) return;
  try { history.pushState({ id }, "", "#i=" + id); } catch {}
}
function clearRoute(){
  if (!CAN_HISTORY) return;
  try { if (location.hash) history.pushState({}, "", location.pathname + location.search); } catch {}
}

/* ===== detail view ===== */
function valueRow(key, value, swatchColor){
  const b = document.createElement("button");
  b.type = "button"; b.className = "vrow";
  b.setAttribute("aria-label", "Copy " + key + " " + value);
  if (swatchColor){
    const chip = document.createElement("span");
    chip.className = "chip"; chip.style.background = swatchColor;
    b.appendChild(chip);
  }
  const k = document.createElement("span"); k.className = "k"; k.textContent = key;
  const v = document.createElement("span"); v.className = "v"; v.textContent = value;
  b.append(k, v);
  b.addEventListener("click", () => toClipboard(value, b));
  return b;
}
function miniGrid(list, host){
  if (!list.length){ host.innerHTML = '<p class="none">Nothing yet.</p>'; return; }
  const wrap = document.createElement("div");
  wrap.className = "simgrid";
  list.forEach(it => {
    const b = document.createElement("button");
    b.type = "button";
    b.style.background = background(it.colors, it.type);
    b.setAttribute("aria-label", "Open " + copyValue(it));
    b.addEventListener("click", () => open(it.id));
    wrap.appendChild(b);
  });
  host.replaceChildren(wrap);
}

/* ===== variant preview =====
   A throwaway look at the other gradient rendering. It repaints the hero only;
   `item.type` is never written, so nothing here survives leaving the page. */
let peekType = null;                        // null = showing the item as saved

function describe(item, shownType){
  const words = [...new Set(item.colors.flatMap(hexName))].slice(0, 4);
  return [
    item.name ? item.colors.join(", ") : null,
    shownType,
    item.tags.length ? item.tags.join(", ") : "no keywords",
    "reads as " + words.join(", "),
    new Date(item.date_added).toLocaleDateString()
  ].filter(Boolean).join(" · ");
}
function paintDetail(item){
  const shown = peekType || item.type;
  paintBox(dbox, item.colors, shown);
  $("dsub").replaceChildren();
  if (peekType){
    const tag = document.createElement("span");
    tag.className = "peek";
    tag.textContent = "preview · " + peekType;
    $("dsub").appendChild(tag);
  }
  $("dsub").appendChild(document.createTextNode(describe(item, shown)));
  const other = shown === "smooth" ? "stepped" : "smooth";
  typeBtn.setAttribute("aria-pressed", String(!!peekType));
  typeBtn.title = peekType ? "Back to the saved " + item.type + " variant"
                           : "Preview the " + other + " variant";
  typeLabel.textContent = typeBtn.title;
}
function setPeek(next, item){
  peekType = next;
  paintDetail(item);
}

function open(id, push = true){
  const item = items.find(i => i.id === id);
  if (!item) return showLibrary();
  openId = id;
  closeEdit();

  library.hidden = true; detail.hidden = false;
  detail.style.animation = "none"; void detail.offsetWidth; detail.style.animation = "";

  $("dtitle").textContent = item.name || item.colors.join("  ");
  /* Only multi-color items have another variant to look at. */
  typeBtn.hidden = item.colors.length < 2;
  peekType = null;                    // every open starts on the saved variant
  paintDetail(item);

  /* values */
  const vals = $("dvalues");
  vals.replaceChildren();
  item.colors.forEach(c => {
    const [r,g,b] = rgb(c), [h,s,l] = hsl(c), [hh,ss,vv] = hsv(c), [cy,m,y,k] = cmyk(c);
    vals.appendChild(valueRow("Hex", c, c));
    vals.appendChild(valueRow("RGB", `rgb(${r}, ${g}, ${b})`));
    vals.appendChild(valueRow("HSL", `hsl(${h}, ${s}%, ${l}%)`));
    vals.appendChild(valueRow("HSB", `${h}\u00B0 ${ss}% ${vv}%`));
    vals.appendChild(valueRow("CMYK", `${cy} ${m} ${y} ${k}`));
  });
  if (item.colors.length > 1){
    vals.appendChild(valueRow("CSS", background(item.colors, item.type)));
    vals.appendChild(valueRow("List", item.colors.join(", ")));
    vals.appendChild(valueRow("JSON", JSON.stringify(item.colors)));
  }

  /* similar */
  const near = items.filter(i => i.id !== id)
    .map(i => ({ i, d: itemDist(item, i) }))
    .filter(x => x.d < 115)
    .sort((a,b) => a.d - b.d).slice(0, 12).map(x => x.i);
  miniGrid(near, $("dnear"));

  const nearIds = new Set(near.map(i => i.id));
  const shared = items.filter(i => i.id !== id && !nearIds.has(i.id))
    .map(i => ({ i, n: i.tags.filter(t => [...expand(t)].some(e => item.tags.some(mt => [...expand(mt)].includes(e)))).length }))
    .filter(x => x.n > 0)
    .sort((a,b) => b.n - a.n).slice(0, 12).map(x => x.i);
  miniGrid(shared, $("dtags"));

  if (push) pushRoute(id);
  $("dtitle").focus();
}

function showLibrary(push = true){
  openId = null; peekType = null; closeEdit();
  detail.hidden = true; library.hidden = false;
  library.style.animation = "none"; void library.offsetWidth; library.style.animation = "";
  render();
  if (push) clearRoute();
}

/* ===== edit ===== */
function closeEdit(){
  editMeta.hidden = true;
  displayMeta.hidden = false;
  editBtn.setAttribute("aria-expanded", "false");
  editBtn.textContent = "Edit";
  delBtn.classList.remove("armed");
  delBtn.textContent = "Delete";
}
function openEdit(){
  const item = items.find(i => i.id === openId);
  if (!item) return;
  eName.value = item.name || "";
  eColors.value = item.colors.join(" ");
  eTags.value = item.tags.join(" ");
  editType = item.type === "smooth" ? "smooth" : "stepped";
  [...eSeg.querySelectorAll("button")].forEach(b => b.setAttribute("aria-pressed", String(b.dataset.type === editType)));
  displayMeta.hidden = true;
  editMeta.hidden = false;
  editBtn.setAttribute("aria-expanded", "true");
  editBtn.textContent = "Cancel";
  refreshEdit();
  eName.focus();
  eName.setSelectionRange(eName.value.length, eName.value.length);
}
function cancelEdit(){
  const item = items.find(i => i.id === openId);
  closeEdit();
  peekType = null;                                    // a preview never survives the editor
  if (item) paintDetail(item);                        // hero box back to what's saved
}
function refreshEdit(){
  const colors = parseColors(eColors.value);
  eSeg.classList.toggle("on", colors.length >= 2);
  paintBox(dbox, colors, editType);                   // edit previews in the hero box itself
}
async function saveEdit(){
  const item = items.find(i => i.id === openId);
  if (!item) return;
  const colors = parseColors(eColors.value);
  if (!colors.length){ say("Needs at least one valid hex"); eColors.focus(); return; }
  if (findBySignature(signature(colors), item.id)){ say("Another item already has those colors"); return; }
  item.name = eName.value.trim();
  item.colors = colors;
  item.type = colors.length === 1 ? "single" : editType;
  item.tags = eTags.value.split(/[\s,]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
  await persist();
  open(item.id, false);
  say("Updated");
}
async function removeOpen(){
  const item = items.find(i => i.id === openId);
  if (!item) return;
  items = items.filter(i => i.id !== openId);
  await persist();
  showLibrary();
  say("Deleted " + copyValue(item));
}

/* ===== events ===== */
cmd.addEventListener("input", () => {
  if (mode === "search" && cmd.value.startsWith("/")){ cmd.value = cmd.value.slice(1); setMode("add", true); return; }
  if (mode === "add") refreshEntry(); else render();
});
cmd.addEventListener("keydown", e => {
  if (e.key === "Enter" && mode === "add"){ e.preventDefault(); (e.metaKey || e.ctrlKey) ? add() : nameIn.focus(); }
  if (e.key === "Escape" && mode === "add"){ cmd.value = ""; tags.value = ""; nameIn.value = ""; setMode("search", true); }
});
nameIn.addEventListener("keydown", e => {
  if (e.key === "Enter"){ e.preventDefault(); tags.focus(); }
  if (e.key === "Escape"){ cmd.value = ""; tags.value = ""; nameIn.value = ""; setMode("search", true); cmd.focus(); }
});
tags.addEventListener("keydown", e => {
  if (e.key === "Enter"){ e.preventDefault(); add(); }
  if (e.key === "Escape"){ cmd.value = ""; tags.value = ""; nameIn.value = ""; setMode("search", true); cmd.focus(); }
});
modeBtn.addEventListener("click", () => { setMode(mode === "add" ? "search" : "add", true); cmd.focus(); });
$("save").addEventListener("click", add);
seg.addEventListener("click", e => {
  const btn = e.target.closest("button[data-type]"); if (!btn) return;
  entryType = btn.dataset.type;
  [...seg.querySelectorAll("button")].forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
  refreshEntry();
});

$("back").addEventListener("click", () => (CAN_HISTORY && history.length > 1) ? history.back() : showLibrary());
$("home").addEventListener("click", () => showLibrary());
editBtn.addEventListener("click", () => editMeta.hidden ? openEdit() : cancelEdit());
eColors.addEventListener("input", refreshEdit);
eSeg.addEventListener("click", e => {
  const btn = e.target.closest("button[data-type]"); if (!btn) return;
  editType = btn.dataset.type;
  [...eSeg.querySelectorAll("button")].forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
  refreshEdit();
});
typeBtn.addEventListener("click", () => {
  const item = items.find(i => i.id === openId);
  if (!item || item.colors.length < 2) return;
  const shown = peekType || item.type;
  /* Toggling back to the item's own type clears the preview entirely, so the
     button reads as off whenever what you see is what is stored. */
  const next = shown === "smooth" ? "stepped" : "smooth";
  setPeek(next === item.type ? null : next, item);
  say(peekType ? "Previewing " + peekType + " — not saved" : "Showing saved " + item.type);
});

$("eSave").addEventListener("click", saveEdit);
eTags.addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); saveEdit(); }});
eColors.addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); eTags.focus(); }});
eName.addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); eColors.focus(); }});

let armTimer;
delBtn.addEventListener("click", () => {
  if (delBtn.classList.contains("armed")) return removeOpen();
  delBtn.classList.add("armed");
  delBtn.textContent = "Tap again to delete";
  clearTimeout(armTimer);
  armTimer = setTimeout(() => { delBtn.classList.remove("armed"); delBtn.textContent = "Delete"; }, 4000);
});

document.addEventListener("keydown", e => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (e.key === "/" && !typing){
    e.preventDefault();
    if (!detail.hidden) showLibrary();
    setMode("add", true); cmd.focus();
  }
  if (e.key === "Escape" && !detail.hidden){ editMeta.hidden ? showLibrary() : cancelEdit(); }
});
if (CAN_HISTORY) window.addEventListener("popstate", e => (e.state && e.state.id) ? open(e.state.id, false) : showLibrary(false));

/* ===== shuffle ===== */
const shuffleBtn = $("shuffle"), shuffleIcon = shuffleBtn.querySelector("svg");
shuffleBtn.addEventListener("click", () => {
  if (items.length < 2){ say(items.length ? "Only one item" : "Nothing to shuffle"); return; }
  reshuffle();
  render();
  shuffleIcon.classList.remove("spin"); void shuffleIcon.offsetWidth; shuffleIcon.classList.add("spin");
  say("Shuffled");
});

/* ===== import / export =====
   window.prompt() throws outright in some embedding contexts, which is what
   used to make Import a dead button. Everything runs through an inline panel
   instead, which doubles as the manual fallback when the clipboard is denied. */
const iopanel = $("iopanel"), ioText = $("ioText"), ioTitle = $("ioTitle"),
      ioHint = $("ioHint"), ioGo = $("ioGo");
let ioMode = null;

function openIO(kind, text){
  ioMode = kind;
  const importing = kind === "import";
  ioTitle.textContent = importing ? "Import" : "Export";
  ioHint.textContent = importing ? "Duplicates are skipped."
                                 : "Clipboard unavailable — copy this by hand.";
  ioGo.textContent = importing ? "Import" : "Done";
  ioText.readOnly = !importing;
  ioText.placeholder = importing ? "Paste a Tessera export here" : "";
  ioText.value = text || "";
  iopanel.hidden = false;
  void iopanel.offsetWidth;          // let [hidden] drop before animating open
  iopanel.classList.add("open");
  ioText.focus();
  if (!importing) ioText.select();
}
function closeIO(){
  ioMode = null;
  iopanel.classList.remove("open");
  const done = () => { if (!iopanel.classList.contains("open")){ iopanel.hidden = true; ioText.value = ""; } };
  setTimeout(done, 320);
}

function runImport(){
  const raw = ioText.value.trim();
  if (!raw){ say("Nothing to import"); ioText.focus(); return; }
  let incoming;
  try { incoming = JSON.parse(raw); }
  catch { say("Import failed: not valid JSON"); ioText.focus(); return; }
  if (!Array.isArray(incoming)){ say("Import failed: expected a list"); ioText.focus(); return; }

  let added = 0, skipped = 0, bad = 0;
  incoming.forEach(i => {
    if (!i || !Array.isArray(i.colors)){ bad++; return; }
    const colors = parseColors(i.colors.join(" "));
    if (!colors.length){ bad++; return; }
    if (findBySignature(signature(colors))){ skipped++; return; }
    items.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2,7),
      name: typeof i.name === "string" ? i.name : "",
      colors,
      type: i.type || (colors.length === 1 ? "single" : "stepped"),
      tags: Array.isArray(i.tags) ? i.tags.filter(t => typeof t === "string") : [],
      date_added: i.date_added || new Date().toISOString()
    });
    added++;
  });

  persist(); render();
  closeIO();
  const notes = [];
  if (skipped) notes.push(skipped + " duplicate" + (skipped > 1 ? "s" : ""));
  if (bad) notes.push(bad + " unreadable");
  say("Imported " + added + (notes.length ? " — skipped " + notes.join(", ") : ""));
}

$("export").addEventListener("click", async () => {
  if (!items.length){ say("Nothing to export yet"); return; }
  const json = JSON.stringify(items, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    say("Copied " + items.length + " items as JSON");
  } catch {
    openIO("export", json);          // no clipboard: show it so it can be copied by hand
  }
});
$("import").addEventListener("click", () => {
  if (ioMode === "import") return closeIO();   // second click closes it again
  openIO("import", "");
});
ioGo.addEventListener("click", () => ioMode === "import" ? runImport() : closeIO());
$("ioCancel").addEventListener("click", closeIO);
ioText.addEventListener("keydown", e => {
  if (e.key === "Escape"){ e.stopPropagation(); closeIO(); }
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ioMode === "import"){ e.preventDefault(); runImport(); }
});

/* ===== boot ===== */
(async () => {
  items = await store.load();
  reshuffle();                 // a fresh arrangement on every visit
  setMode("search", false);
  const m = CAN_HISTORY ? /^#i=(.+)$/.exec(location.hash) : null;
  if (m && items.some(i => i.id === m[1])) open(m[1], false); else cmd.focus();
})();
