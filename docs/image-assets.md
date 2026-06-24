# Referencing image assets (icons / art)

This repo deliberately **does not** mirror the `Art/` tree from upstream — it's
hundreds of MB of `.png` / `.webp` / `.dds` image assets, not data.

**Offline-first plan:** render a **placeholder** for every icon. If the device
is online, the real icon loads from **ggpk-exposed** (the CDN RePoE points at)
*over* the placeholder; offline, the placeholder just stays. No build step, no
pre-fetch, nothing breaks on a plane.

Why this works cleanly: every art-bearing record carries a stable
`visual_identity.id` and a deterministic `dds_file` path (verified **100%**
coverage on `base_items.json` and `uniques.json`). So a placeholder keyed on
`id`/`name` and its eventual real icon are 1:1 — the same item always maps to
the same placeholder *and* the same CDN URL.

## The join key: `visual_identity.dds_file`

Most data records that have art carry a `visual_identity` object:

```jsonc
// data/repoe-poe2/base_items.json -> "Metadata/Items/Currency/CurrencyWeaponQuality"
"visual_identity": {
  "id": "CurrencyWeaponQuality",
  "dds_file": "Art/2DItems/Currency/CurrencyWeaponQuality.dds"
}
```

```jsonc
// data/repoe-poe2/uniques.json -> "Astramentis"
"visual_identity": {
  "id": "FourUniqueAmulet15",
  "dds_file": "Art/2DItems/Amulets/Uniques/Astramentis.dds"
}
```

The `dds_file` value is the in-game asset path. That's what you feed to the CDN.

## URL pattern

```
https://image.ggpk.exposed/{game}/{dds_file}?format={png|webp}
```

- `{game}` — use **`poe2`** for everything in this repo.
- `{dds_file}` — the `visual_identity.dds_file` value, verbatim (it already
  starts with `Art/...`).
- `?format=` — the upstream assets are `.dds`. Add `?format=png` (lossless,
  wider support) or `?format=webp` (smaller) to get a web-renderable image.
  Without the query param, content negotiation decides.

### Verified example

```
visual_identity.dds_file = "Art/2DItems/Currency/CurrencyWeaponQuality.dds"

-> https://image.ggpk.exposed/poe2/Art/2DItems/Currency/CurrencyWeaponQuality.dds?format=png
   200 OK, content-type: image/png (~17 KB)
```

## Placeholder-first wiki helper (drop-in)

The pattern: render a placeholder immediately, then point an `<img>` at the CDN
URL with an `onerror` handler that hides the broken image and reveals the
placeholder. Online → real icon; offline → placeholder. Zero conditional logic
about connectivity.

```js
const GGPK = "https://image.ggpk.exposed";
const GAME = "poe2";

/** Real icon URL (online only). null if the record has no art. */
function iconUrl(record, { format = "webp" } = {}) {
  const dds = record?.visual_identity?.dds_file;
  return dds ? `${GGPK}/${GAME}/${dds}?format=${format}` : null;
}

/** Stable placeholder descriptor for a record — works with zero network. */
function placeholder(record) {
  const name = record?.name ?? record?.visual_identity?.id ?? "?";
  // deterministic: same id -> same label/color every render
  const key = record?.visual_identity?.id ?? name;
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const initials = name.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return { label: name, initials, hue: h % 360, key };
}
```

React-style render — placeholder is always present; the real icon paints over it
when it loads, and removes itself if it can't (offline / 404):

```jsx
function Icon({ item }) {
  const ph = placeholder(item);
  const url = iconUrl(item);
  return (
    <span class="icon" title={ph.label}
          style={{ background: `hsl(${ph.hue} 40% 30%)` }}>
      <span class="icon-ph">{ph.initials}</span>
      {url && (
        <img src={url} alt={ph.label} loading="lazy"
             onLoad={e => e.target.classList.add("loaded")}
             onError={e => e.target.remove()} />
      )}
    </span>
  );
}
```

```css
.icon { position: relative; display: inline-grid; place-items: center;
        width: 48px; height: 48px; border-radius: 6px; overflow: hidden; }
.icon-ph { font: 600 14px/1 system-ui; color: #fff; }
.icon img { position: absolute; inset: 0; width: 100%; height: 100%;
            object-fit: contain; opacity: 0; transition: opacity .15s; }
.icon img.loaded { opacity: 1; }   /* only a successfully loaded icon shows */
```

Pure-HTML equivalent (no framework) — same idea, inline `onerror`:

```html
<span class="icon" style="background:hsl(210 40% 30%)" title="Astramentis">
  <span class="icon-ph">AS</span>
  <img src="https://image.ggpk.exposed/poe2/Art/2DItems/Amulets/Uniques/Astramentis.dds?format=webp"
       alt="Astramentis" loading="lazy"
       onload="this.classList.add('loaded')" onerror="this.remove()">
</span>
```

Python helper (same fields, e.g. for a static-site generator):

```python
GGPK, GAME = "https://image.ggpk.exposed", "poe2"

def icon_url(record: dict, fmt: str = "webp") -> str | None:
    dds = (record.get("visual_identity") or {}).get("dds_file")
    return f"{GGPK}/{GAME}/{dds}?format={fmt}" if dds else None

def placeholder(record: dict) -> dict:
    name = record.get("name") or (record.get("visual_identity") or {}).get("id") or "?"
    key = (record.get("visual_identity") or {}).get("id") or name
    h = 0
    for c in key:
        h = (h * 31 + ord(c)) & 0xFFFFFFFF
    initials = "".join(w[0] for w in name.split())[:2].upper()
    return {"label": name, "initials": initials, "hue": h % 360, "key": key}
```

## Notes & gotchas

- **Placeholders need nothing.** They render from `name` + `visual_identity.id`,
  both already in the JSON — fully offline. The `onerror`/`onload` dance means a
  failed CDN fetch is invisible: you just keep the placeholder.
- **`pob-uniques/` has no art field.** Those entries are raw PoB text blocks
  (unique name = line 1). To get an icon for a PoB unique, match its name
  against `repoe-poe2/uniques.json` to pull the `dds_file`. For a placeholder
  you don't even need that — the name is right there on line 1.
- The `{game}` segment is required to disambiguate poe1 vs poe2 assets; always
  send `poe2`.
- Other art-bearing files (skill gems, buffs, passives) follow the same
  `visual_identity.dds_file` convention where present.
- If you *later* decide you want real icons offline too, the pre-fetch sketch
  below caches them locally — but with the placeholder pattern you don't need
  it for the flight.

## Pre-fetch script sketch (optional, for true offline)

If you later decide you want the icons local, this collects every distinct
`dds_file` and downloads the PNGs into `assets/`:

```bash
python3 - <<'PY'
import json, os, urllib.request
from pathlib import Path

dds = set()
for f in ["data/repoe-poe2/base_items.json", "data/repoe-poe2/uniques.json"]:
    for rec in json.load(open(f)).values():
        vi = (rec or {}).get("visual_identity") or {}
        if vi.get("dds_file"):
            dds.add(vi["dds_file"])

print(f"{len(dds)} distinct icons")
for d in sorted(dds):
    out = Path("assets") / (d[:-4] + ".png")   # Art/.../X.dds -> assets/Art/.../X.png
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        continue
    url = f"https://image.ggpk.exposed/poe2/{d}?format=png"
    try:
        urllib.request.urlretrieve(url, out)
    except Exception as e:
        print("!", d, e)
PY
```
