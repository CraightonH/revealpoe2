# Referencing image assets (icons / art)

The `scrape.py` data mirror deliberately **skips** the `Art/` tree — it's
hundreds of MB of `.png` / `.webp` / `.dds` image assets, not data.

**Implemented approach — self-hosted, fetched at build time.** The build step
`build:images` (`scripts/fetch-images.js`) downloads every referenced `.dds`
from ggpk.exposed as webp into `public/img/` (gitignored), and the renderer
(`src/data/images.js` → `ddsUrl`) emits same-origin `/static/img/...webp` paths.
**The live site never touches a third-party CDN at runtime** — ggpk.exposed is a
build-time dependency only. See *Self-hosting* below; the placeholder/`onerror`
pattern in this doc remains the fallback for the handful of assets that fail
upstream or haven't been fetched.

Why this works cleanly: every art-bearing record carries a stable
`visual_identity.id` and a deterministic `dds_file` path (verified **100%**
coverage on `base_items.json` and `uniques.json`). So a placeholder keyed on
`id`/`name` and its self-hosted icon are 1:1 — the same item always maps to the
same placeholder *and* the same image file.

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

## Runtime path (what the app emits)

`ddsUrl(dds)` maps a `dds_file` to its self-hosted webp:

```
Art/2DItems/Currency/CurrencyWeaponQuality.dds
  -> /static/img/Art/2DItems/Currency/CurrencyWeaponQuality.webp
```

The `.dds` extension is replaced with `.webp` and the file is served from
`public/img/` (mirrored into `dist/static/img/` by the prerender). No query
string, no external host. `imageRelPath()` in `src/data/images.js` is the single
source of truth for this mapping, shared by the renderer and the fetcher.

## Build-time source URL (ggpk.exposed)

`scripts/fetch-images.js` fetches each asset once from:

```
https://image.ggpk.exposed/{game}/{dds_file}?format=webp     # {game} = poe2
```

`?format=webp` converts the upstream `.dds` to a web-renderable image. This URL
appears **only** in the fetcher, never in shipped pages.

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

## Self-hosting (`scripts/fetch-images.js`)

This is the implemented version of what used to be an "optional pre-fetch" — now
a build step, not a sketch. It is the reason the live site has no runtime CDN
dependency.

**What it does:** reads the referenced `.dds` set from `build/graph.json` (plus
the UI-chrome paths baked into `public/css/`), and for each one fetches
`?format=webp` from ggpk.exposed into `public/img/<path>.webp`. Run via
`npm run build:images`, wired into `build:static` ahead of `build:index`.

**Drift handling** — the whole point of doing this as a reconciler rather than a
one-shot download:

| Change | Mechanism |
|--------|-----------|
| New images (game adds content) | New `.dds` paths appear in the graph after re-scrape → not on disk → fetched. |
| Re-arted icon, **same path** | ggpk serves nginx ETags (`"{mtime}-{size}"`); the fetcher stores them and sends `If-None-Match`. `304` = unchanged (skip), `200` = changed → re-download. |
| Removed images | On-disk files no longer referenced are pruned (`--no-prune` to keep). |

**Operational properties:**

- **Idempotent + cheap to re-run.** After the first sync (~3 min for ~3k images),
  unchanged images return `304` — re-validating the whole set takes seconds, so
  it's safe inside every `npm run deploy`.
- **Rate-limit-aware.** ggpk.exposed is one person's free Cloudflare Worker and
  rate-limits sustained load (HTTP 429). Default concurrency is 8 with
  exponential backoff honoring `Retry-After`. Tune with `--workers N`.
- **Resilient.** A fetch failure keeps any existing local copy so the build still
  succeeds; only never-seen images are left to the placeholder. A few assets 500
  upstream on ggpk's side (bad/spaced source paths) — those just fall back.
- **Manifest:** `public/img/_manifest.json` stores `{ ddsPath: { etag, bytes } }`
  for conditional requests. Delete it (or pass `--force`) to force a full
  re-download.

Flags: `--workers N`, `--no-prune`, `--force`.
