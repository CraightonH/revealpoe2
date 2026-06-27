# Passive skill tree — architecture

**The passive tree render is sourced from GGG's OWN official web data + sprite
atlases, NOT from RePoE.** This is a deliberate, project-wide exception to the
"everything derives from `data/source/repoe-poe2/` via `scrape.py`" rule in
CLAUDE.md. Read this before touching anything under the passive tree.

Why the exception: RePoE's `passive_skill_trees/Default.json` lacks the
precomputed per-edge **arc geometry** (each connection's arc centre + radius)
that makes connectors sweep along their orbit instead of crossing, and it has no
web sprite atlases. GGG publishes both, unauthenticated, at the endpoint their
own tree renderer consumes. Re-deriving the arcs from RePoE is not feasible
(only ~2% of arc centres coincide with a group centre; the rest are bespoke).

RePoE still backs the rest of the passive domain — the passive **pages** and
graph **relationships** (keystone/notable detail pages, gem cross-references).
Only the canvas **render** is GGG-sourced. The two are matched by node hash.

---

## Data source & ingestion

`scripts/fetch-ggg-tree.js` (`npm run fetch:tree`) pulls everything from GGG:

- **Tree data** → `data/source/ggg-poe2/passive-tree.json` (~2.3MB)
  from `https://pathofexile2.com/internal-api/content/game-passive-skill-tree`
- **Atlas frame maps** (`.json`) → `data/source/ggg-poe2/atlas/<name>.json`
- **Atlas images** (`.webp`) → `public/img/passive-atlas/<name>.webp` (self-hosted)

The atlas URLs come from the tree JSON's own `context.assets` map (versioned).
`data/source/ggg-poe2/` is gitignored like the rest of `data/source/`; it's
fetched, not committed.

**Pipeline wiring**
- `build:static` runs `fetch:tree` first, so deploy ingests fresh data + atlases.
- `fetch-images.js` excludes `public/img/passive-atlas/` from its orphan prune
  (`EXTERNAL_DIRS`) — that dir is managed by `fetch-ggg-tree`, not the GGPK sync.
- `predev`/`pretest` do **not** run `fetch:tree` (no network on every start).
  A fresh checkout must run `npm run fetch:tree` once; `gggTree.js` throws a
  clear "Run: node scripts/fetch-ggg-tree.js" if the data is missing.

**Update loop after a game patch:** `npm run fetch:tree` (alongside `scrape.py`),
then `npm run deploy`.

---

## GGG data shape (`context.data`)

- `nodes` — keyed by skill hash. Fields used: `skill`, `name`, `icon`
  (`Art/...png` path), `stats` (array of **already-English** strings in our
  `[tag|text]` keyword format), `x`/`y` (**absolute** world coords), `orbit`,
  `orbitIndex`, `group`, `ascendancyId`, and flag booleans:
  `isKeystone` / `isNotable` / `isMastery` / `isJewelSocket` /
  `isAscendancyStart` / `classStartIndex`.
- `edges` — `{from, to}` for a straight connection, or
  `{from, to, orbit, orbitX, orbitY}` for an arc. `orbitX/orbitY` is the arc
  **centre**; the radius is `dist(centre, node)` (equal for both endpoints).
- `classes` — `name`, `base_str/dex/int`, `image` (class illustration),
  `image_offset_x/y` (centres the art in the frame), and `ascendancies[]`
  (each with `image`, `offsetX/offsetY`, flavour).
- `min_x/min_y/max_x/max_y` — tree extent.

Origin `(0,0)` is the centre of the 6-class start hexagon.

---

## Sprite atlases

Each atlas is an image (`/static/img/passive-atlas/<name>.webp`) + a frame map
(`/static/generated/passive-atlas/<name>.json`, copied from `data/source` by the
build). Maps are PixiJS spritesheets: `{ frames: { key: { frame:{x,y,w,h} } },
meta: { scale } }`. **`scale` is 0.5**, so a sprite's native (world-unit) size =
`frame.w / scale`. Sub-rects are drawn straight from the atlas via canvas
`drawImage(img, sx,sy,sw,sh, ...)`.

| Atlas | Key convention | Used for |
|---|---|---|
| `skills` / `skills-disabled` | `{normal\|notable\|keystone}{Active\|Inactive}:{icon-path}` | node icons (Active = allocated, Inactive = else) |
| `frame` | `frame:<Kind>Frame<State>` (`KeystoneFrameAllocated`, `NotableFrameCanAllocate`, `PSSkillFrame`/`…Highlighted`/`…Active` for small, `JewelFrame…`, `AscendancyFrameNotable…`, `AscendancyFrameNormal…`, `AscendancyStartNode`) | node frames by kind + state |
| `group-background` | `startNode:MainCircle` (+ `…Active`) | central ornate class-frame ring (native 4000) |
| `background-<class>` | `class<Class>:Class0` | central class illustration (native 3000) |
| `line` | `LineConnector{Normal\|Intermediate\|Active}`, `Orbit{1-9}{state}` | **not currently used** — see Connectors below |
| `jewel`, `jewel-radius`, `mastery-effect-*` | — | not yet rendered |

Icon sprites are authored smaller than their frame sprites (small icon 68 inside
frame 102, etc.), so drawing both at native size, centred, nests correctly — no
manual fudge factor.

---

## Build (`scripts/build-passive-tree.js`)

`scripts/graph/gggTree.js` `parseGggTree()` reads the GGG JSON → `{nodes, edges,
classStarts, classes, ascStarts, ascByClass, ascArt, extent}`:
- node kind from the flags above (`kindOf`); **masteries are dropped** (TODO #7 —
  non-selectable pass-throughs).
- icon-kind prefix (`iconKindOf`) for the skills-atlas key.
- arc params (`arcFor`): centre, radius, `a0`/`a1` (canvas-convention angles via
  `atan2`), and `ccw` chosen so the **minor** arc is drawn.
- class-start roots (`classStartIndex`) flagged `hidden` — kept as allocation
  anchors but not drawn (covered by the frame's clover ornaments).

`build-passive-tree.js` emits:
- `public/generated/passive-tree.json` — `{nodes, edges, meta}`. Nodes carry
  `h,x,y,k,name,icon,iconKind,asc,ws,(lock),(hidden)`. `lock` = GGG's
  `unlockConstraint` (`{nodes:[…], asc}`): the node is hidden until its gating
  node(s) are allocated — e.g. Oracle's "The Unseen Path" (5571) reveals ~176
  main-tree "Paths Not Taken" nodes that otherwise carry no `ascendancyId` and
  would clutter the main tree always. The renderer's `nodeVisible`/`lockSatisfied`
  gate these. `meta` has `classStarts`,
  `classArt` (per-class atlas + frame key + offsets), `ascStarts`
  (ascId→start hash), `ascByClass` (class→`[{id,name}]`, drives the selector),
  `ascendancyArt` (ascId→`{img, class}`), `atlas` (base paths + `classFrame`),
  `extent`, `pointBudget`.
- **Ascendancy cluster centring:** `gggTree.js` translates each ascendancy's
  nodes (and their arc-edge centres) so the cluster's start node lands on its
  owning class's hexagon start node — baked into the artifact coords. Clusters
  are hidden unless their ascendancy is selected, so the only visible cluster is
  always anchored to the active class's start (Monk's enters from the upper-right,
  Warrior's from the left, etc.). Only the 8 classes with ascendancy node data
  (== those with a `background-<class>` atlas) get surfaced; the 4 PoE1-legacy
  class slots have no nodes/art and self-exclude — no hardcoded list.
- `public/generated/passive-atlas/*.json` — the atlas frame maps (served copy).
- `public/generated/passive-cards.json` — one hover card per visible node, keyed
  by hash, built from GGG stats keyword-linkified through `renderGameText`.

---

## Renderer (`public/js/passive-tree.js`)

- **Atlases** load lazily via `atlas(name)` (returns null until ready, triggers a
  redraw on load). `drawSprite(name, key, wx, wy, {w,h,ox,oy})` draws a sprite
  centred at a world point; defaults to the sprite's native size.
- **Draw order** (`draw()`): `drawClassCentre()` → `drawEdges()` → `drawNodes()`.
- **Nodes**: icon (active vs disabled atlas by alloc state) then frame
  (`FRAME_KEY[kind][state]`) on top. State `frameState(n)`: `x` allocated/anchor,
  `a` allocatable (`_canAllocateSync`), `u` else. Hidden roots skipped.
- **Connectors** (`drawEdges`): **stroked**, not textured. Straight = line; arc =
  `ctx.arc(cx,cy,r,a0,a1,ccw)` using GGG's exact geometry, so they sweep along
  the orbit without crossing. Coloured by state (`LINE_COLOR`: dim bronze →
  golden) at `LINE_WIDTH` world units. (The `line` atlas exists but the
  ring-texture-clip approach produced artifacts; stroking is the chosen render.)
- **Centre** (`drawCentre`): clips to the ring + draws the `group-background`
  `MainCircle` frame on top. Inside, when no ascendancy is selected it draws the
  active class's illustration (`drawClassArt`: `background-<class>` atlas `Class0`,
  offset by GGG's `image_offset`); when an ascendancy is selected it draws that
  ascendancy's illustration (`drawAscArt`: a plain ggpk webp, no atlas, scaled to
  cover the ring and **centred on origin** — GGG's per-ascendancy offset anchors
  to the cluster's native group centre, so it's dropped; the illustrations frame
  their figure centrally and centre cleanly).
- **Class/ascendancy selector**: two `<select>`s (`#tree-class`, `#tree-ascendancy`)
  in the controls bar. Selecting a class swaps the art + start anchor and resets
  the tree; selecting an ascendancy sets `activeAsc`, reveals that cluster
  (`nodeVisible` gates draw + hit-test: a node shows only if `asc == null` or
  `asc === activeAsc`), and swaps the centre art. Imported share codes sync the
  selector via `ascStarts`/`ascendancyArt` reverse-lookups. `activeClass` defaults
  to the first selectable class.
- **Generic-attribute nodes** (`attr`, the 293 "+5 to any Attribute" nodes): the
  card shows a Str/Int/Dex choice (`.attr-opt[data-attr]`, built in `buildCards`).
  Picking an option allocates the node with that attribute; the node icon is then
  tinted the stat colour (`ATTR_COLOR`: red/green/blue) and the card collapses to
  the chosen line. To change it, deallocate (node-click, which clears the pick via
  `pruneAttrChoices`) and reallocate. Per-node picks live in `attrChoice`
  (`attrOf` defaults to Strength, e.g. for imported builds). Not yet encoded into
  the share-code tag word.
- **Ascendancy art self-hosting**: the illustrations have no GGG web atlas, so
  they ride the ggpk `.dds`→webp pipeline like node icons. `fetch-images.js`'s
  `ddsFromPassiveArtifact()` reverse-maps `meta.ascendancyArt[].img` URLs into the
  referenced `.dds` set so deploy mirrors them.
- **Hit-testing** uses fixed per-kind world radii (`KIND_RADIUS`, = half the GGG
  frame sprite native size); drawing sizes come from the atlas directly.
- Allocation/encoding (`passive-alloc.js`, `passive-code.js`), pan/zoom, and the
  Tippy hover card are unchanged — adjacency is rebuilt from the GGG edges.

---

## Tunables & conventions

- `LINE_WIDTH` / `LINE_COLOR` — connector thickness + palette.
- `KIND_RADIUS` — hit-test radii; keep in sync with `frame.json` sizes
  (atlas px / scale / 2) if GGG changes the frame art.
- Class-art placement comes from GGG (`image_offset`); don't hand-tune.

## Known gaps / deferrals

- **Masteries** excluded (TODO #7).
- **Weapon-set mode** is inert — GGG node data has no per-node weapon-set flag, so
  `ws` is 0 everywhere.
- **Ascendancy placement & class/ascendancy selector** — done (TODO #6). Clusters
  are centred on their class start and hidden until selected; see Build + Renderer.
- **Textured connectors** — deferred in favour of stroked lines.

## Key files

| File | Role |
|---|---|
| `scripts/fetch-ggg-tree.js` | ingest GGG data + atlases (`npm run fetch:tree`) |
| `scripts/graph/gggTree.js` | parse GGG JSON → nodes/edges/classes |
| `scripts/build-passive-tree.js` | emit render artifact + cards + atlas-map copy |
| `public/js/passive-tree.js` | canvas renderer (atlases, connectors, allocation) |
| `data/source/ggg-poe2/` | cached GGG data + atlas maps (gitignored) |
| `public/img/passive-atlas/` | self-hosted atlas images (gitignored) |
| `scripts/graph/passives.js` + `src/data/passiveTree.js` | **RePoE** passive pages/relationships (unchanged) |
