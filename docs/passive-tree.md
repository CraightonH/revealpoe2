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
| `mastery-effect-active` / `mastery-effect-disabled` | `masteryEffect{Active\|Inactive}:{effect-image-path}` | cluster background patterns (lit vs dim) — see Masteries below |
| `jewel`, `jewel-radius` | — | not yet rendered |

Icon sprites are authored smaller than their frame sprites (small icon 68 inside
frame 102, etc.), so drawing both at native size, centred, nests correctly — no
manual fudge factor.

---

## Build (`scripts/build-passive-tree.js`)

`scripts/graph/gggTree.js` `parseGggTree()` reads the GGG JSON → `{nodes, edges,
classStarts, classes, ascStarts, ascByClass, ascArt, extent}`:
- node kind from the flags above (`kindOf`). **Masteries are not selectable
  nodes** — they're pulled out of the node/edge/allocation graph and collected
  separately (`parseGggTree().masteries`) as background-effect records: `{ h, x,
  y, effect, triggers[], lock? }`. `effect` is GGG's `activeEffectImage` (→
  mastery-effect atlas key); `triggers` are the connected nodes (gathered from the
  edge list — the node's own `in` misses ~40) that light the effect when
  allocated. See **Masteries** under Renderer.
- icon-kind prefix (`iconKindOf`) for the skills-atlas key.
- arc params (`arcFor`): centre, radius, `a0`/`a1` (canvas-convention angles via
  `atan2`), and `ccw` chosen so the **minor** arc is drawn.
- class-start roots (`classStartIndex`) flagged `hidden` — kept as allocation
  anchors but not drawn (covered by the frame's clover ornaments).

`build-passive-tree.js` emits:
- `public/generated/passive-tree.json` — `{nodes, edges, masteries, meta}`.
  `masteries[]` = `{ h, x, y, e (effect path), t (trigger hashes), lock? }`; the
  renderer draws these as background patterns (see **Masteries**). Nodes carry
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
- `public/generated/passive-stats.json` — raw GGG stat lines per visible node,
  keyed by hash, **markup preserved** (unlike `passive-search.json`, which strips
  it). Drives the client-side stat aggregation panel. Multi-line stat strings are
  split so each line is an independent summable unit (`buildStats()`).

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
- **Masteries** (`drawMasteryEffects`, drawn after the centre, under connectors +
  nodes): each `masteries[]` record anchors a decorative "mastery effect" pattern
  at the cluster's mastery position. Drawn **dim** (`mastery-effect-disabled`
  atlas) by default and **lit** (`mastery-effect-active`) when any of its `t`
  trigger nodes is allocated in *any* layer (`masteryActive` → `isAllocatedAnywhere`
  ∪ starts) — mirroring in-game, where connecting into a cluster lights its
  background. The mastery node itself is never drawn (not a selectable node).
  Visibility follows the same gate as nodes (`masteryVisible` → `lockSatisfied`),
  so the ~21 unlock-gated masteries (e.g. Oracle's "Paths Not Taken" clusters)
  only appear once their gating node + ascendancy are active. Sprites draw at
  `MASTERY_SCALE`× their ~488-world native size (a tunable — GGG renders the
  pattern/glow larger than native to fill the cluster ring). The atlas images +
  maps are already synced by `fetch-ggg-tree` / `copyAtlasMaps` — no fetch-images
  or prerender change needed.
- **Class/ascendancy selector**: two `<select>`s (`#tree-class`, `#tree-ascendancy`)
  in the controls bar. Selecting a class swaps the art + start anchor and resets
  the tree; selecting an ascendancy sets `activeAsc`, reveals that cluster
  (`nodeVisible` gates draw + hit-test: a node shows only if `asc == null` or
  `asc === activeAsc`), and swaps the centre art. Imported share codes sync the
  selector via `ascStarts`/`ascendancyArt` reverse-lookups. `activeClass` defaults
  to the first selectable class.
- **Generic-attribute nodes** (`attr`, the 293 "+5 to any Attribute" nodes):
  three-state card driven by `paintAttrChoice()` (`.attr-generic` + `.attr-choice`
  in `buildCards`/`passive.njk`). Resting (unallocated) shows the generic "+5 to
  any Attribute" line; **clicking the node opens** a Str/Int/Dex picker
  (`attrChoosing` tracks the open node — it does *not* auto-allocate) and clicking
  an option (`.attr-opt[data-attr]`, `onAttrOptionClick`) allocates with that
  attribute. The node icon then swaps to GGG's dedicated per-attribute sprite
  (`ATTR_ICON`: red `plusstrength` / green `plusdexterity` / blue
  `plusintelligence`, all in the skills atlas beside the generic `plusattribute`)
  and the card collapses to the chosen line. To change it, deallocate (node-click,
  which clears the pick via `pruneAttrChoices`) and re-pick. Per-node picks live in
  `attrChoice` (`attrOf` defaults to Strength). Picks round-trip through the share
  code as the per-record **tag word** — the GGG `skillOverride` id of the chosen
  attribute (`generic_attribute_strength`=26297, `_dexterity`=14927,
  `_intelligence`=57022; see `passive-code.js` `ATTR_TAG`/`TAG_ATTR`). Export writes
  it (`synthesizeState`); `importFromHash` reads it back into `attrChoice`, so an
  imported Intelligence node no longer replays as Strength.
- **Ascendancy art self-hosting**: the illustrations have no GGG web atlas, so
  they ride the ggpk `.dds`→webp pipeline like node icons. `fetch-images.js`'s
  `ddsFromPassiveArtifact()` reverse-maps `meta.ascendancyArt[].img` URLs into the
  referenced `.dds` set so deploy mirrors them.
- **Stat aggregation panel** (`#tree-stats-panel`, left-docked, collapsible): on
  every alloc/dealloc, `updatePoints()` also calls `renderStats()`, which lazy-loads
  `passive-stats.json` + the pure `passive-stats-agg.js` module, builds the effective
  stat lines of all allocated non-hidden nodes (resolving generic "+5 to any
  Attribute" nodes to the player's `attrChoice` pick via `effectiveAttrLine`), and
  renders summed totals bucketed into Offense / Defense / Attributes / Other plus a
  verbatim **Unique Effects** section for number-less keystone/flag lines. The
  aggregation is pure + node-tested (`test/passiveStatsAgg.test.js`); the categories
  are approximate keyword heuristics. Numbers render white on muted prose for
  at-a-glance scanning.
  - **Hover-to-highlight:** dwelling on a panel line for `HOVER_DELAY` (500ms)
    highlights *every* node granting that stat — allocated or not — via `hoverHits`,
    a transient layer drawn over `searchHits` so it doesn't disturb an active query.
    Matching is by the agg module's number-less `template`, looked up in
    `templateIndex` (template → node hashes, built once over all nodes from the stat
    artifact). Generic "+5 to any Attribute" nodes are also keyed under the three
    resolved attribute templates, so hovering a summed "+N to Strength" lights every
    attribute node. The dwell timer restarts when the cursor moves between lines
    (debounce) and clears on leaving the panel.
  - **Click-to-pin:** clicking a line moves its match set into the persistent
    `searchHits` layer and fills the search box with `templateToQuery(template)` (the
    longest number-free phrase; attribute lines → "any attribute"), so the highlight
    survives the cursor leaving and reads as a normal, editable/clearable search.
    Hovering other lines still previews over the pin (hover wins, then reverts).
- **Shortest-path preview + one-click allocation** (`public/js/passive-path.js`,
  pure + node-tested in `test/passivePath.test.js`): hovering an unallocated node
  highlights the fastest route to it from the allocated frontier (`allocated ∪
  starts`), and **clicking allocates the whole route in one click**.
  - `shortestPath(adj, sources, target, {isPathable, isAttr})` is a multi-source
    BFS (lexicographic-cost Dijkstra over a min-heap) minimising **node count =
    passive points**, tie-broken to route through the **fewest generic
    "+5 to any Attribute" filler nodes** when two routes are the same length —
    so a free detour around filler is taken but the path is *never* lengthened.
    Returns the ordered hashes that would be newly allocated (target last), or
    null if the target is already allocated / unreachable.
  - The renderer passes `isPathable = nodeVisible` so routes never cross hidden
    roots, unsatisfied unlock-gated nodes, or non-active ascendancy clusters, and
    `isAttr = !!node.attr`. The preview is recomputed in the `pointermove`
    hit-test only when the hovered node changes (`pathTarget`), and cleared on
    pan / leave / alloc / dealloc. `drawPathEdges()` strokes the route over the
    normal connectors (reusing GGG's exact arc geometry) in a bright white-gold
    (`PATH_COLOR`); `drawPathRings()` rings each route node and draws a `+N pts`
    cost pill on the target.
  - **Click rule:** a route of length **≥ 2** collapses into one click
    (`_allocatePathSync` — generic-attribute nodes on it default to the class's
    **primary attribute**, `classArt[class].attr`, derived at build time as the
    argmax of base str/dex/int; each stays re-pickable via the usual node-click
    respec). A length-1 route (target directly adjacent) **falls through to the
    existing single-step behaviour**, so the attribute picker is preserved for
    adjacent attribute-node clicks. Scope: allocation-only (no dealloc preview).
- **Touch / mobile** (TODO #6): pan + zoom go through a single **pointer map**
  (`pointers` Map in the interaction block) — one pointer = pan (unchanged mouse
  drag), two pointers = **pinch-zoom** (`beginPinch`/`pinchGeom`: the world point
  under the initial two-finger midpoint stays pinned under the moving midpoint,
  same anchor math as the wheel zoom). Lifting one finger of a pinch hands off to a
  fresh pan from the remaining finger so the view doesn't jump. The canvas sets
  `touch-action: none` (CSS) so the browser doesn't steal gestures for page
  scroll / double-tap-zoom. Touch has **no hover**, so allocation is a
  **tap-inspect → tap-confirm** model: the first tap on a node shows its card +
  shortest-path preview (`showCardFor`) without allocating; a second tap on the
  **same** node commits via `commitTap` (the shared alloc/dealloc/path-collapse
  body, also called by the desktop click). `touchInspect` holds the inspected
  hash; a pan/pinch/other-node tap clears it. Mouse click still commits on the
  first click — the touch two-step is gated on `e.pointerType === 'touch'`.
  Narrow-viewport CSS (`@media max-width:640px`) caps both overlay panels to the
  screen and scrolls their bodies; `@media (hover:none) and (pointer:coarse)`
  grows tap targets to ~40–44px and hides the Fullscreen button (iOS Safari only
  fullscreens `<video>`). The wrap uses `100dvh` so a collapsing mobile URL bar
  doesn't clip the canvas.
- **Hit-testing** uses fixed per-kind world radii (`KIND_RADIUS`, = half the GGG
  frame sprite native size); drawing sizes come from the atlas directly.
  `nodeAtClient(clientX, clientY)` is the shared closest-visible-node hit-test used
  by hover, tap, and click.
- Allocation/encoding (`passive-alloc.js`, `passive-code.js`), pan/zoom, and the
  Tippy hover card are unchanged — adjacency is rebuilt from the GGG edges.

---

## Tunables & conventions

- `LINE_WIDTH` / `LINE_COLOR` — connector thickness + palette.
- `KIND_RADIUS` — hit-test radii; keep in sync with `frame.json` sizes
  (atlas px / scale / 2) if GGG changes the frame art.
- Class-art placement: the PoE2 `Class0` illustrations are pre-centred circular
  sprites filling their 3000² frame, so they draw at native size centred on
  origin with **no offset**. GGG's `image_offset_x/y` are stale PoE1 values
  inherited via the shared class-slot index and are zeroed in `gggTree.js` — do
  not re-apply them (they shove the figure off the MainCircle).

## Weapon-set passives

Two **extra 25-point pools**, one per weapon set, allocated independently and
overlaid on the shared main tree (PoE2's Weapon Set Passive Skills). Spec:
`docs/superpowers/specs/2026-06-29-weapon-set-passives-design.md`.

- **Three layers:** `allocated` (shared/main, 122), `wsAlloc[1]`, `wsAlloc[2]`
  (25 each). A node lives in at most one layer. There is **no per-node weapon-set
  flag in GGG data** (`ws` is 0 everywhere) — any reachable passive can be
  weapon-set allocated; "which set" is an *allocation* property, not a node one.
- **Connectivity (pure, `passive-alloc.js`, node-tested):** a Set-_k_ node must
  touch `allocated ∪ starts ∪ wsAlloc[k]` — roots in the shared tree, chains
  within its own set, never through the other set (`wsCanAllocate`). Removing a
  main node re-anchors both sets (`pruneWeaponSets`); `wsDeallocate` cascades
  within a set. Budget gated by `wsCanAfford` against `meta.weaponSetBudget` (25).
- **Editing model:** two buttons (`#tree-ws-sets [data-ws-set]`) set `wsMode ∈
  {null,1,2}`. Default (null) edits the shared tree; clicking a set enters its
  mode (re-click to exit). In Set-_k_ mode the shared tree shows normally, the
  set's nodes get an accent ring + colored connectors (`WS_COLOR`: 1=red, 2=green),
  the other set's nodes appear unallocated, and the shortest-path preview tints to
  the set colour. View state is `viewAllocated()`; the path frontier + budget
  follow `wsMode`.
- **Share code:** the v7 codec already round-trips weapon-set records (subType
  `0x02`/`0x03`); import routes them into `wsAlloc[1/2]`, export emits them. Any
  edit clears `decodedState` so Copy Share Code rebuilds from current state.

## Notable instill recipes

Every tree Notable carries a GGG `recipe` — the **3 Distilled Emotions** that,
combined into an Instilling Orb, stamp that Notable onto a jewel/amulet. Surfaced
at the bottom of the notable's hover card as three centred boxes (emotion icon +
name), each a nested tooltip resolving the emotion's detail card.

- **Resolution** (`scripts/graph/emotions.js`, pure + node-tested in
  `test/passiveInstill.test.js`): recipe tokens (`ConcentratedLiquidFear`) are the
  emotion's `base_items.json` name with spaces stripped. `buildEmotionIndex()`
  maps token → `DistilledEmotion*` currency item; `resolveRecipe()` **throws** on
  an unknown token so a GGG rename fails the build rather than silently dropping
  the relation. `gggTree.js` carries `recipe` onto notable nodes.
- **Artifacts** (`build-passive-tree.js`): `buildCards` sets `vm.instill` (3
  ordered boxes, duplicates preserved); `buildEmotions` emits
  `public/generated/instill-emotions.json` (per-emotion detail card: effect
  keyword-linkified, how-to-instill directions, stack size) and stamps
  `meta.instillIcons` into the tree artifact.
- **Passive card headers**: notable/keystone/ascendancy hover + detail cards use
  the dedicated in-game passive banners (`NotablePassiveHeader` /
  `KeystonePassiveHeader` / `AscendancyPassiveHeader`, rounded gold-bordered),
  selected in `gem-card.css` by the popup's `is-notable`/`is-keystone`/`is-asc`
  class — not the plain `ItemsHeaderWhite` item banner. CSS-referenced, so they
  self-host via `ddsFromCss`.
- **Emotion card look** (`partials/emotion-card-fragment.njk`): mirrors the
  in-game currency tooltip — the `NormalPopup` frame with the ornate
  `ItemsHeaderCurrency` banner (swirled corners, distinct from the plain
  `ItemsHeaderWhite` other bases use) and a tan currency title. The currency
  header slices enter the image set via `ddsFromCss` (CSS-referenced), not the
  graph.
- **Runtime**: `src/data/emotions.js` reads the artifact; `/api/emotion/:key/card`
  (in `pages.js`, `partials/emotion-card-fragment.njk`) serves the nested card.
  The box `data-card-url` is auto-discovered by `prerender.js` `passiveCardSeeds()`
  and auto-fetched by `fetch-images.js` (`meta.instillIcons`, currency icons
  aren't in the browsable graph) — no changes needed in either.

## Embeddable component (build editor)

The renderer is **embeddable**: `init(canvas, data, opts)` scopes every control
lookup to `opts.root` (default `canvas.closest('.passive-tree-wrap')`) instead of
`document`, and **injects the control panels** from the shared pure module
`public/js/tree-panel.js` (`treePanelsHtml()`) if `root` has none. The panels use
`data-tree-*` hooks (not ids), so two embeds can coexist on one page without
collisions. `load(canvas, opts)` forwards `opts`.

**Page chrome is host-owned** — `init` no longer touches `location.*`,
`navigator.clipboard`, or `window.confirm`:
- `opts.initialCode` — share code imported on boot (replaces the old
  `location.hash` read); `opts.initialFocus` — node hash to center (replaces the
  `?node=` read).
- `opts.onCopy(code)` — Copy handler (default: clipboard-write the code);
  `opts.confirmReset()` — Reset confirmation (default `window.confirm`).
- `opts.onChange()` — fired after any allocation/class/ascendancy change;
  `opts.onCodeChange(code)` — the current share code, **debounced** (400 ms), for
  persistence; `opts.onReady(api)` — after the boot import settles.

**Extended API** (on the `init` return): `getState()`/`setState(code)`,
`getCode()`/`setCode(code)`, `setHighlight(hashes)` (wraps the `hoverHits`
layer), `focusNode(hash)`, `getAllocatedNotables()` → `[{h,kind,name,icon}]`,
`getPoints()` → `{main,asc,ws1,ws2}` each `{spent,max}`, `paintNodeIcon(hash,
canvasEl)` (blits the node's `skills`-atlas sprite into a canvas), `deallocate(h)`
(main-tree), and `destroy()` (disconnect ResizeObserver + listeners + timers).

**Class/ascendancy mirroring** — `getClassAscendancy()` → `{className, ascId,
fromCode}` and `setClassAscendancy(className, ascId, {keepAllocation})`. A share
code cannot state its own class: the v7 header's class byte is always written as
10 (see `passive-code.js synthesizeState`), so `importCode` *infers* the owner by
BFS-ing each class start over the decoded allocation (`identityFromDecoded`, a
pure export). **An allocation-free code therefore proves nothing** — it reports
`fromCode: false`, the import keeps the identity it already had, and a host with
its own class picker must NOT adopt the embed's answer. Ignoring that is how a
freshly-picked "Druid / Oracle" build (class chosen, zero points spent, so an
8-byte header-only code) came back as "Warrior / none" after a reload: the
inference fell through to the artifact's first class start and the build editor
adopted the guess group-wide. An ascendancy that is chosen but has no allocated
nodes is recovered from the header's 1-based ascendancy byte. Regression cover:
`test/passiveTreeIdentity.test.js` + the last two checks in
`scripts/verify-tree-embed.mjs`.

**Hosts:**
- `/passives` (`views/passives.njk`) is a thin host: bare `<canvas>` in the wrap,
  an inline module script wiring `initialCode`/`initialFocus` from the URL and
  `onCopy` back to `location.hash` + clipboard. Historic behavior unchanged.
- The **build editor** (`public/js/build-editor.js`) mounts one embed into the
  Dossier's Passive Tree chapter (`[data-tree-mount]`), **reparents** its DOM
  across dossier re-renders (so allocation state survives gear/skill edits),
  auto-saves `tree.code` on `onCodeChange` (with a `suppressRender` guard so the
  save doesn't tear down the embed), and renders the **Notable Priority** list
  (`public/js/tree-priority.js`: `reconcilePriority` + `renderPriorityList`) from
  `getAllocatedNotables()`. Hovering a priority row → `setHighlight`; clicking →
  `focusNode`; drag reorders; remove → `deallocate`. Order persists as
  `tree.notablePriority: [hash]`. Read-only/import previews show a static summary
  + deep link (no live canvas). Headless coverage: `scripts/verify-tree-embed.mjs`.

## Known gaps / deferrals

- **Mastery backgrounds** — done (TODO #6): dim/lit cluster patterns (see
  **Masteries** under Renderer). The lit state is a static swap, not the animated
  pulse GGG plays; the mastery nodes themselves remain non-selectable.
- **Ascendancy placement & class/ascendancy selector** — done (TODO #6). Clusters
  are centred on their class start and hidden until selected; see Build + Renderer.
- **Textured connectors** — deferred in favour of stroked lines.

## Key files

| File | Role |
|---|---|
| `scripts/fetch-ggg-tree.js` | ingest GGG data + atlases (`npm run fetch:tree`) |
| `scripts/graph/gggTree.js` | parse GGG JSON → nodes/edges/classes (carries `recipe`) |
| `scripts/graph/emotions.js` | Distilled Emotion index + recipe resolver (instill UI) |
| `scripts/build-passive-tree.js` | emit render artifact + cards + atlas-map copy |
| `public/js/passive-tree.js` | canvas renderer (atlases, connectors, allocation, stat panel) |
| `public/js/passive-stats-agg.js` | pure stat aggregation (strip→templatize→sum→categorize) |
| `public/js/passive-path.js` | pure shortest-path finder (hover preview + one-click path allocation) |
| `data/source/ggg-poe2/` | cached GGG data + atlas maps (gitignored) |
| `public/img/passive-atlas/` | self-hosted atlas images (gitignored) |
| `scripts/graph/passives.js` + `src/data/passiveTree.js` | **RePoE** passive pages/relationships (unchanged) |
