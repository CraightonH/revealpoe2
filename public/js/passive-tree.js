// public/js/passive-tree.js
// Canvas 2D renderer for the Path of Exile 2 passive skill tree.
// Fetches the prebuilt artifact, handles pan/zoom, and draws edges + nodes.
//
// Default export: init(canvas, data) — sets up event listeners + draw loop.
// Named exports: worldToScreen, screenToWorld — pure helpers (node-testable).

const ARTIFACT_URL = '/static/generated/passive-tree.json';

// ---------------------------------------------------------------------------
// Pure coordinate helpers (no DOM; node-testable)
// ---------------------------------------------------------------------------

/**
 * Transform a world-space point to screen (canvas) coordinates.
 * view = { ox, oy, scale }  where ox/oy is the world origin in screen space.
 * @param {{ ox: number, oy: number, scale: number }} view
 * @param {number} x world x
 * @param {number} y world y
 * @returns {{ x: number, y: number }}
 */
export function worldToScreen(view, x, y) {
  return {
    x: view.ox + x * view.scale,
    y: view.oy + y * view.scale,
  };
}

/**
 * Transform a screen (canvas) point back to world coordinates.
 * @param {{ ox: number, oy: number, scale: number }} view
 * @param {number} sx screen x
 * @param {number} sy screen y
 * @returns {{ x: number, y: number }}
 */
export function screenToWorld(view, sx, sy) {
  return {
    x: (sx - view.ox) / view.scale,
    y: (sy - view.oy) / view.scale,
  };
}

// ---------------------------------------------------------------------------
// Node kind visual config
// ---------------------------------------------------------------------------

// Node hit-test radii in world units (== half the GGG frame sprite's native
// size). Used for pointer hit-testing; drawing sizes come from the atlas frames
// directly. Kept in sync with frame.json sprite sizes (atlas px / 0.5 / 2).
const KIND_RADIUS = {
  keystone:   109,
  notable:    76,
  blighted:   76,
  small:      51,
  ascStart:   45,
  ascNotable: 103,
  ascSmall:   80,
  jewel:      76,
};

// kind -> frame.json sprite keys by allocation state (u=unallocated,
// a=allocatable, x=allocated). Prefixed 'frame:' to match the atlas keys.
const FRAME_KEY = {
  keystone:   { u: 'KeystoneFrameUnallocated', a: 'KeystoneFrameCanAllocate', x: 'KeystoneFrameAllocated' },
  notable:    { u: 'NotableFrameUnallocated', a: 'NotableFrameCanAllocate', x: 'NotableFrameAllocated' },
  // Disconnected "instilled on an item" notables (DeliriumAnoint_*) — ornate gold frame.
  blighted:   { u: 'BlightedNotableFrameUnallocated', a: 'BlightedNotableFrameCanAllocate', x: 'BlightedNotableFrameAllocated' },
  small:      { u: 'PSSkillFrame', a: 'PSSkillFrameHighlighted', x: 'PSSkillFrameActive' },
  jewel:      { u: 'JewelFrameUnallocated', a: 'JewelFrameCanAllocate', x: 'JewelFrameAllocated' },
  ascNotable: { u: 'AscendancyFrameNotableUnallocated', a: 'AscendancyFrameNotableCanAllocate', x: 'AscendancyFrameNotableAllocated' },
  ascSmall:   { u: 'AscendancyFrameNormalUnallocated', a: 'AscendancyFrameNormalCanAllocate', x: 'AscendancyFrameNormalAllocated' },
  ascStart:   { u: 'AscendancyStartNode', a: 'AscendancyStartNode', x: 'AscendancyStartNode' },
};

// Connector stroke colours by state, matched to GGG's line art (dim bronze →
// golden when allocated). Stroking with GGG's exact arc geometry gives clean,
// non-crossing connectors without the fragility of clipping ring textures.
const LINE_COLOR = { u: '#4b4534', a: '#8c7a4e', x: '#c8aa6e' };
// GGG draws each connector as a "double rail": two thin parallel lines with a
// real gap between them (not one solid stroke). We reproduce it geometrically —
// each rail is its own thin stroke offset perpendicular from the centreline
// (concentric r±offset for arcs), leaving a true transparent gap that matches at
// any zoom and survives crossings, with no background-colour dependency.
const LINE_RAIL_W = 3.2;   // each rail's thickness, world units
const LINE_RAIL_OFF = 4.4; // centreline → rail offset (half the rail spacing), world units
// An allocated connector (both ends taken, state 'x') is drawn as a single solid
// stroke instead of the double rail — matching GGG, where the active path fills
// in. Width ≈ the rail pair's outer span so thickness doesn't jump on allocate.
const LINE_SOLID_W = 11; // world units

// Shortest-path preview (hover a node → its fastest route from the allocated
// frontier glows; clicking allocates the whole route). A bright white-gold,
// distinct from both the solid-gold *allocated* state and the dim *allocatable*
// rails so it reads as "preview, not committed".
const PATH_COLOR = '#fff3c4';
const PATH_LINE_W = 7;   // world units (~1.5× a rail pair's span)
const PATH_RING_W = 5;   // node-ring stroke, world units

// Weapon-set accent colours: Set I = red, Set II = green. `line` strokes the
// set's allocated connectors + node ring; `path` tints its shortest-path preview.
const WS_COLOR = {
  1: { line: '#e0584e', path: '#ff8a80' },
  2: { line: '#5bbf6a', path: '#9be8a6' },
};
const WS_RING_W = 5; // allocated-node ring stroke, world units

// When a generic-attribute node is allocated with a chosen stat, GGG swaps the
// icon to a dedicated per-attribute sprite (red Strength / green Dexterity /
// blue Intelligence cross), not a flat colour overlay — these live in the same
// skills atlas as the generic `plusattribute` icon. Map the pick → icon path so
// the sprite key resolves like any other node icon.
const ATTR_ICON = {
  str: 'Art/2DArt/SkillIcons/passives/plusstrength.png',
  dex: 'Art/2DArt/SkillIcons/passives/plusdexterity.png',
  int: 'Art/2DArt/SkillIcons/passives/plusintelligence.png',
};

// Fraction of the MainCircle frame's half-width to clip the central illustration
// to. The ornate ring band occupies the outer ~25% of the frame, so the inner
// opening (where the start-node hexagon sits, ~1470 of the 2000 half-width) is
// ~0.74 — clip there so the art fills the opening without bleeding over the ring.
const CENTER_CLIP_FILL = 0.74;

// ---------------------------------------------------------------------------
// Adjacency builder (with skip-guard for ghost nodes)
// ---------------------------------------------------------------------------

/**
 * Build an adjacency map from the artifact's node set and edge list.
 * CRITICAL: edges array contains ~224 edges touching nameless "ghost" nodes
 * not present in the artifact. We ONLY add an edge when both endpoints exist
 * in the nodeSet, mirroring scripts/graph/passiveSource.js buildAdjacency's
 * skip-guard, so ghosts can't bridge real nodes and create phantom BFS paths.
 * @param {object[]} nodes
 * @param {object[]} edges
 * @returns {Map<number, number[]>}
 */
function buildAdjacency(nodes, edges) {
  const nodeSet = new Set(nodes.map((n) => n.h));
  const adj = new Map();
  for (const n of nodes) adj.set(n.h, []);
  for (const e of edges) {
    if (nodeSet.has(e.a) && nodeSet.has(e.b)) {
      adj.get(e.a).push(e.b);
      adj.get(e.b).push(e.a);
    }
  }
  return adj;
}

// ---------------------------------------------------------------------------
// Renderer setup
// ---------------------------------------------------------------------------

/**
 * Draw the passive tree on a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {{ nodes: object[], edges: object[], meta: object }} data
 */
export default function init(canvas, data) {
  const ctx = canvas.getContext('2d');
  const { nodes, edges, meta } = data;

  // Build a hash→node map for fast lookup.
  const nodeMap = new Map(nodes.map((n) => [n.h, n]));

  // Build adjacency (with skip-guard for ghost nodes).
  const adj = buildAdjacency(nodes, edges);

  // --- Sprite atlases (GGG's own web art) ---
  // Each atlas is an image + a frame map ({key:{frame:{x,y,w,h}}}, meta.scale).
  // Loaded lazily; atlas() returns null until ready and triggers a redraw on load.
  // native world size of a sprite = atlas px / scale (atlases are authored at 0.5).
  const ATLAS = meta.atlas;
  const classArt = meta.classArt ?? null;
  const ascByClass = meta.ascByClass ?? {};      // className -> [{id,name}]
  const ascStarts = meta.ascStarts ?? {};        // ascId -> start node hash
  const ascendancyArt = meta.ascendancyArt ?? {}; // ascId -> {img,offsetX,offsetY,class}
  // Classes the selector offers: only those with ascendancy data (== those with
  // a background illustration). Ordered as GGG lists them where possible.
  const selectableClasses = Object.keys(ascByClass);
  let activeClass = selectableClasses[0] ?? 'Monk';
  let activeAsc = null; // ascId when an ascendancy is selected, else null

  const atlasCache = new Map(); // name -> {img, frames, scale} | 'loading' | 'error'
  // Plain-image cache for ascendancy illustrations (no GGG atlas; ggpk webp).
  const imgCache = new Map(); // url -> Image | 'loading' | 'error'
  function loadImg(url) {
    const c = imgCache.get(url);
    if (c instanceof Image) return c;
    if (!c) {
      imgCache.set(url, 'loading');
      const im = new Image();
      im.onload = () => { imgCache.set(url, im); requestDraw(); };
      im.onerror = () => imgCache.set(url, 'error');
      im.src = url;
    }
    return null;
  }
  function atlas(name) {
    const c = atlasCache.get(name);
    if (c && typeof c === 'object') return c;
    if (!c) {
      atlasCache.set(name, 'loading');
      Promise.all([
        fetch(`${ATLAS.map}/${name}.json`).then((r) => r.json()),
        new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = `${ATLAS.img}/${name}.webp`; }),
      ]).then(([map, img]) => {
        atlasCache.set(name, { img, frames: map.frames, scale: Number(map.meta?.scale) || 1 });
        requestDraw();
      }).catch(() => atlasCache.set(name, 'error'));
    }
    return null;
  }

  // Draw an atlas sprite centred at world (wx,wy). w/h default to the sprite's
  // native size; ox/oy offset in world units (for class-art placement).
  // opts.rotate (radians) spins the sprite about its own centre.
  function drawSprite(name, key, wx, wy, opts = {}) {
    const at = atlas(name);
    if (!at) return false;
    const f = at.frames[key];
    if (!f) return false;
    const fr = f.frame;
    const inv = 1 / at.scale;
    const w = (opts.w ?? fr.w * inv) * view.scale;
    const h = (opts.h ?? fr.h * inv) * view.scale;
    const s = worldToScreen(view, wx + (opts.ox || 0), wy + (opts.oy || 0));
    if (opts.rotate) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(opts.rotate);
      ctx.drawImage(at.img, fr.x, fr.y, fr.w, fr.h, -w / 2, -h / 2, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(at.img, fr.x, fr.y, fr.w, fr.h, s.x - w / 2, s.y - h / 2, w, h);
    }
    return true;
  }

  const radiusOf = (k) => KIND_RADIUS[k] ?? 51;

  // Class-start roots sit under the central frame's clover ornaments and aren't
  // selectable — hide from render + hit-test, keep as allocation anchors.
  const hiddenNodes = new Set(nodes.filter((n) => n.hidden).map((n) => n.h));

  // A node is drawable/hittable when it isn't a hidden anchor, belongs to the
  // main tree (asc == null) or the active ascendancy, and — if it's an
  // unlock-gated node (e.g. Oracle's "Paths Not Taken") — its gating node(s) are
  // allocated. Without the lock gate those ~190 nodes would clutter the main
  // tree by default; they reveal only once The Unseen Path is taken.
  function nodeVisible(n) {
    if (hiddenNodes.has(n.h)) return false;
    if (n.asc != null && n.asc !== activeAsc) return false;
    if (n.lock && !lockSatisfied(n.lock)) return false;
    return true;
  }

  function lockSatisfied(lock) {
    if (lock.asc != null && lock.asc !== activeAsc) return false;
    for (const g of lock.nodes) {
      if (!allocated.has(g) && !starts.includes(g)) return false;
    }
    return true;
  }

  // Is a node allocated in ANY layer (shared or either weapon set)? Allocated
  // weapon-set nodes always render as allocated (with their set accent),
  // regardless of which set is being edited.
  function isAllocatedAnywhere(h) {
    return allocated.has(h) || wsAlloc[1].has(h) || wsAlloc[2].has(h);
  }

  // Allocation state for a node: x = allocated/anchor, a = allocatable, u = else.
  // 'x' is mode-independent (an allocated node always looks allocated); 'a' is
  // mode-aware (only what the active mode can actually allocate is highlighted).
  function frameState(n) {
    if (isAllocatedAnywhere(n.h) || starts.includes(n.h)) return 'x';
    if (_canAllocateSync(n.h)) return 'a';
    return 'u';
  }

  // The solid-connector accent for an edge, or null if it isn't an allocated
  // connector. A main connector (both ends shared) is gold; a weapon-set
  // connector (both ends in the shared tree ∪ that set, at least one in the set)
  // is the set's colour. Mode-independent, so allocated ws branches always show.
  function solidConnectorColor(na, nb) {
    const aMain = allocated.has(na.h) || starts.includes(na.h);
    const bMain = allocated.has(nb.h) || starts.includes(nb.h);
    if (aMain && bMain) return LINE_COLOR.x;
    for (const k of [1, 2]) {
      const ak = aMain || wsAlloc[k].has(na.h);
      const bk = bMain || wsAlloc[k].has(nb.h);
      if (ak && bk && (wsAlloc[k].has(na.h) || wsAlloc[k].has(nb.h))) return WS_COLOR[k].line;
    }
    return null;
  }

  // Rail (unallocated edge) brightness: 'a' if it touches any allocated node.
  function railState(na, nb) {
    const aOn = isAllocatedAnywhere(na.h) || starts.includes(na.h);
    const bOn = isAllocatedAnywhere(nb.h) || starts.includes(nb.h);
    return (aOn || bOn) ? 'a' : 'u';
  }

  // Initial view: center the tree in the canvas.
  // Compute world bounds.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  const worldW = maxX - minX;
  const worldH = maxY - minY;
  const worldCx = (minX + maxX) / 2;
  const worldCy = (minY + maxY) / 2;

  // Fit scale so the tree fills ~80% of the smaller canvas dimension, then zoom
  // in by DEFAULT_ZOOM so we open closer to the start than the full-tree view.
  // `view` is mutable; it's re-fit by fitView() once real canvas dimensions
  // arrive (the ResizeObserver fires after layout — at init the drawing buffer
  // is still the default 300×150).
  const DEFAULT_ZOOM = 5;
  // Zoom caps, expressed as multiples of baseFit (the scale at which the whole
  // tree fills ~80% of the canvas). Anchoring to baseFit keeps the limits
  // resolution/DPI-independent — both ends scale with the canvas. The opening
  // view (DEFAULT_ZOOM) sits between them, so it's never clamped on load.
  const MIN_SCALE_FACTOR = 1.5;
  const MAX_SCALE_FACTOR = 13;
  let minScale = 0;          // recomputed by fitView() against the real buffer
  let maxScale = Infinity;
  // Origin (0,0) is the center of the 6-class start hexagon — the point we want
  // centered on load.
  const CENTER_X = 0;
  const CENTER_Y = 0;
  const view = { scale: 1, ox: 0, oy: 0 };
  let fitted = false;

  function fitView() {
    const baseFit = Math.min(
      (canvas.width  * 0.8) / (worldW || 1),
      (canvas.height * 0.8) / (worldH || 1),
    );
    minScale = baseFit * MIN_SCALE_FACTOR;
    maxScale = baseFit * MAX_SCALE_FACTOR;
    const fitScale = baseFit * DEFAULT_ZOOM;
    view.scale = fitScale;
    // Center on the origin (0,0) — the start hexagon — rather than the extent
    // midpoint, which is skewed by hidden ascendancy clusters and locked nodes
    // and drifts visibly off-center once zoomed in.
    view.ox = canvas.width  / 2 - CENTER_X * fitScale;
    view.oy = canvas.height / 2 - CENTER_Y * fitScale;
  }

  // Initial fit against whatever the buffer currently is (a reasonable default;
  // corrected by the ResizeObserver's first real-dimension fit).
  fitView();

  // ---------------------------------------------------------------------------
  // Allocation state
  // ---------------------------------------------------------------------------

  // allocated: Set<number> — shared/main node hashes the user has allocated.
  // starts: number[] — class root + ascendancy start (always-present anchors, not counted in points).
  // wsAlloc: { 1:Set, 2:Set } — per-weapon-set node hashes (each its own 25-pt pool),
  //   overlaid on the shared tree. A node here is NOT in `allocated`.
  // wsMode: null | 1 | 2 — which set is being edited/viewed; null = shared/main (default).
  // decodedState: the last decode() result, kept for round-trip encode().
  let allocated    = new Set();
  let starts       = [];
  const wsAlloc    = { 1: new Set(), 2: new Set() };
  let wsMode       = null;
  let decodedState = null;
  // attrChoice: Map<hash, 'str'|'int'|'dex'> — per generic-attribute node, which
  // attribute the user picked (the "+5 to any Attribute" choice). Defaults to
  // 'str' on allocation; changed by clicking an option in the node's card.
  const attrChoice = new Map();
  const ATTR_DEFAULT = 'str';

  // Search highlight state. searchHits is null when no query is active (full
  // brightness); otherwise a Set of node hashes matching the query — those draw
  // normally with a glow, everything else dims (SEARCH_DIM). The index (hash ->
  // searchable text) is a build artifact, loaded lazily on first search.
  let searchHits = null;
  let searchIndex = null, searchIndexLoading = null;
  const SEARCH_DIM = 0.14;
  // hoverHits: transient highlight layer for hovering a stat-panel line — a Set
  // of every node hash matching that stat (allocated or not, like search). Drawn
  // *over* searchHits (hover wins) so it doesn't disturb an active search query.
  let hoverHits = null;
  // Shortest-path preview: the route from the allocated frontier to the hovered
  // node. `pathNodes` = ordered hashes that would be newly allocated (target
  // last); `pathNodeSet`/`pathEdgeSet` are draw-time lookups; `pathTarget` is the
  // hovered node it was computed for (so we only recompute when it changes).
  let pathNodes = null;
  let pathNodeSet = null;
  let pathEdgeSet = null;
  let pathTarget = null;
  // Hover-to-highlight bookkeeping for the stat panel. `templateIndex` maps a
  // number-less stat template → every node hash carrying it (built once from the
  // stat artifact); `hoverSets` is the per-rendered-line lookup; the timer
  // enforces the 0.75s dwell before a highlight fires (debounce-on-move).
  let templateIndex = null;
  let hoverSets = [];
  let hoverQueries = [];
  let hoverTemplates = [];
  let hoverTimer = null;
  let hoverIdx = -1;
  const HOVER_DELAY = 500;
  // The template of the stat line currently pinned into the search box (null =
  // none). Tracked by template (not data-hl index) so the `.selected` marker
  // survives panel re-renders, and so a click on the same stat can toggle it off.
  let pinnedTemplate = null;
  const SEARCH_URL = '/static/generated/passive-search.json';
  function loadSearchIndex() {
    if (searchIndex) return Promise.resolve(searchIndex);
    if (!searchIndexLoading) {
      searchIndexLoading = fetch(SEARCH_URL).then((r) => r.json())
        .then((idx) => { searchIndex = idx; return idx; });
    }
    return searchIndexLoading;
  }

  // Determine the active class root from meta.classStarts. Default to the
  // selector's active class on init; overridden on import.
  const classStartValues = Object.values(meta.classStarts ?? {});
  let classRoot = (meta.classStarts ?? {})[activeClass] ?? classStartValues[0] ?? null;

  if (classRoot != null) {
    starts = [classRoot];
  }

  // ---------------------------------------------------------------------------
  // Points DOM
  // ---------------------------------------------------------------------------

  const pointsEl  = document.getElementById('tree-points');
  const wsBtns    = Array.from(document.querySelectorAll('#tree-ws-sets .tree-ws-btn'));
  const wsCountEls = {
    1: document.querySelector('#tree-ws-sets [data-ws-count="1"]'),
    2: document.querySelector('#tree-ws-sets [data-ws-count="2"]'),
  };

  // Stat aggregation panel (left-docked). Totals are recomputed from the
  // allocated set on every alloc/dealloc via renderStats(), driven off the same
  // updatePoints() hook the point counter uses.
  const statsPointsEl = document.getElementById('tree-stats-points');
  const statsListEl   = document.getElementById('tree-stats-list');
  // Raw per-node stat lines (markup-preserved) — a lazy static artifact, like
  // the hover cards. Loaded on first allocation.
  const STATS_URL = '/static/generated/passive-stats.json';
  let statLines = null, statLinesLoading = null;
  function loadStatLines() {
    if (statLines) return Promise.resolve(statLines);
    if (!statLinesLoading) {
      statLinesLoading = fetch(STATS_URL).then((r) => r.json())
        .then((s) => { statLines = s; return s; });
    }
    return statLinesLoading;
  }
  // The pure aggregation module (node-testable; shared with the build test).
  let _aggMod = null;
  function aggMod() {
    if (_aggMod) return Promise.resolve(_aggMod);
    return import('./passive-stats-agg.js').then((m) => { _aggMod = m; return m; });
  }
  // Generic "+5 to any Attribute" nodes resolve to the player's Str/Int/Dex pick
  // before aggregation (the agg module is attribute-agnostic). Keep the line's
  // own number so a future +N variant still sums correctly.
  const ATTR_FULL = { str: 'Strength', int: 'Intelligence', dex: 'Dexterity' };
  function effectiveAttrLine(h) {
    const raw = (statLines[h] && statLines[h][0]) || '+5 to any Attribute';
    const num = (raw.match(/\d+/) || ['5'])[0];
    return `+${num} to ${ATTR_FULL[attrOf(h)] || 'Strength'}`;
  }

  // ---------------------------------------------------------------------------
  // Hover card — pre-rendered passive cards shown through the shared Tippy harness
  // (same theme + nested .kw / granted-skill tooltips as the rest of the site).
  // Cards are a static artifact (lazy-loaded on first hover), keyed by node hash.
  // ---------------------------------------------------------------------------
  const CARDS_URL = '/static/generated/passive-cards.json';
  let cards = null, cardsLoading = null;
  function loadCards() {
    if (cards) return Promise.resolve(cards);
    if (!cardsLoading) {
      cardsLoading = fetch(CARDS_URL).then((r) => r.json()).then((c) => { cards = c; return c; });
    }
    return cardsLoading;
  }

  // One Tippy instance driven by a virtual reference repositioned to the hovered
  // node. Manual trigger; a short hide delay + an over-card flag let the cursor
  // travel from the node into the (interactive) card to reach keyword tooltips.
  let tip = null, hoverHash = null, overTip = false, hideTimer = null;
  // Hash of the generic-attribute node whose Str/Int/Dex picker is currently
  // open (set on node-click, cleared on pick / hover-change / hide). Transient
  // to the hovered node — re-hovering shows the generic line again until clicked.
  let attrChoosing = null;
  let tipRect = { x: 0, y: 0, w: 0, h: 0 };
  function ensureTip() {
    if (tip || !window.tippy) return tip;
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    tip = window.tippy(anchor, {
      theme: 'poe2 passive-tree', allowHTML: true, interactive: true, maxWidth: 'none',
      // hideOnClick defaults to true, which tears down the card on any click
      // outside it — including clicking the node itself (the reference is a
      // virtual anchor, not the canvas). That would hide the card the moment you
      // click to open the attribute picker. We hide manually (scheduleHide /
      // pointerleave / over-card flag), so disable the click-to-hide behaviour.
      hideOnClick: false,
      // appendTo must honour fullscreen: the Fullscreen API renders only the
      // fullscreen element's subtree in the top layer, so a popper appended to
      // document.body (outside .passive-tree-wrap) is invisible and unreachable
      // — taking the hover card and its attribute picker with it. Fall back to
      // body when nothing is fullscreen.
      placement: 'right-start', trigger: 'manual',
      appendTo: () => document.fullscreenElement || document.body,
      offset: [0, 14],
      getReferenceClientRect: () => ({
        width: tipRect.w, height: tipRect.h,
        top: tipRect.y, bottom: tipRect.y + tipRect.h,
        left: tipRect.x, right: tipRect.x + tipRect.w,
        x: tipRect.x, y: tipRect.y,
      }),
      popperOptions: { modifiers: [
        { name: 'preventOverflow', options: { padding: 8, altAxis: true } },
        { name: 'flip', options: { padding: 8, fallbackPlacements: ['left-start', 'top', 'bottom'] } },
      ] },
      onMount(instance) {
        instance.popper.addEventListener('mouseenter', () => { overTip = true; clearTimeout(hideTimer); });
        instance.popper.addEventListener('mouseleave', () => { overTip = false; hideTip(); });
        if (!instance.popper._attrBound) {
          instance.popper._attrBound = true;
          instance.popper.addEventListener('click', onAttrOptionClick);
        }
      },
    });
    return tip;
  }
  function hideTip() { hoverHash = null; attrChoosing = null; if (tip) tip.hide(); }
  function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (!overTip) hideTip(); }, 160); }

  // The picked attribute for an allocated node (defaults to Strength — covers
  // imported builds whose pick we don't yet decode from the share-code tag).
  const attrOf = (h) => attrChoice.get(h) ?? ATTR_DEFAULT;

  // Paint an attribute node's card across its three states:
  //   resting (unallocated, not choosing) → generic "+5 to any Attribute" line;
  //   choosing (node clicked)             → the full Str/Int/Dex picker;
  //   allocated                           → collapse to just the chosen stat.
  // Respec by deallocating (node click), which returns it to the resting line.
  function paintAttrChoice(popper, h) {
    if (!popper) return;
    const alloc = allocated.has(h);
    const choosing = !alloc && attrChoosing === h;
    const chosen = alloc ? attrOf(h) : null;
    const generic = popper.querySelector('.attr-generic');
    const box = popper.querySelector('.attr-choice');
    if (generic) generic.hidden = alloc || choosing;
    if (box) {
      box.hidden = !(alloc || choosing);
      box.classList.toggle('locked', alloc);
      for (const el of box.querySelectorAll('.attr-opt')) {
        const k = el.getAttribute('data-attr');
        el.classList.toggle('chosen', k === chosen);
        el.hidden = alloc && k !== chosen;
      }
    }
  }

  // Clicking an option in an attribute node's card sets that attribute (and
  // allocates the node if it's allocatable), mirroring the in-game pick menu.
  function onAttrOptionClick(e) {
    const opt = e.target.closest('.attr-opt[data-attr]');
    if (!opt) return;
    const h = hoverHash;
    const n = h != null ? nodeMap.get(h) : null;
    if (!n || !n.attr) return;
    if (allocated.has(h)) return;     // locked once selected — respec via node click
    if (!_canAllocateSync(h)) return; // not reachable from the allocated tree yet
    if (!canAfford([h])) return;      // out of passive points — don't record a pick
    attrChoice.set(h, opt.getAttribute('data-attr'));
    _allocateSync(h);
    attrChoosing = null;
    if (tip) paintAttrChoice(tip.popper, h);
    requestDraw();
  }

  function nodeKindOf(h) {
    return nodeMap.get(h)?.k ?? '';
  }

  // Allocation budgets: independent pools — main passive points, ascendancy
  // points, and a per-weapon-set pool (each set gets the full `ws`). Undefined =
  // unbounded (pre-budget artifact / staleness safety).
  function budgets() {
    return {
      main: meta.pointBudget ?? Infinity,
      ascendancy: meta.ascendancyBudget ?? Infinity,
      ws: meta.weaponSetBudget ?? Infinity,
    };
  }

  // Whether the given new-node hashes fit the remaining MAIN budget (all-or-nothing).
  function canAfford(hashes) {
    if (!_allocMod) return false;
    return _allocMod.canAfford(allocated, nodeKindOf, hashes, budgets());
  }

  function updatePoints() {
    if (!_allocMod) return;
    if (pointsEl) {
      const { main, ascendancy } = _allocMod.pointsSpent(allocated, nodeKindOf);
      const b = budgets();
      const seg = (n, max) => (max === Infinity ? `${n}` : `${n} / ${max}`);
      // Top counter: shared + ascendancy only (weapon sets show beside the buttons).
      pointsEl.textContent = `${seg(main, b.main)} points · ${seg(ascendancy, b.ascendancy)} asc`;
      pointsEl.classList.toggle('points-full', main >= b.main || ascendancy >= b.ascendancy);
    }
    // Per-weapon-set counts sit next to the I / II buttons.
    for (const k of [1, 2]) {
      const el = wsCountEls[k];
      if (!el) continue;
      const used = wsAlloc[k].size, max = budgets().ws;
      el.textContent = max === Infinity ? `${used}` : `${used} / ${max}`;
      el.classList.toggle('is-full', used >= max);
    }
    renderStats();
  }

  // Escape + wrap numeric tokens so they render white against muted prose
  // (high-contrast scanning). Input is already plain text from the agg module.
  function escHtml(s) {
    return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }
  function numHtml(s) {
    return escHtml(s).replace(/[+-]?\d[\d.]*%?/g, (m) => `<span class="num">${m}</span>`);
  }

  // template -> Set<hash> over EVERY node (not just allocated), so hovering a
  // stat lights up all nodes that grant it — like the search bar. Generic "+5 to
  // any Attribute" nodes are also keyed under the three resolved attribute
  // templates so hovering "+18 to Strength" highlights every attribute node.
  function buildTemplateIndex() {
    if (templateIndex) return templateIndex;
    const idx = new Map();
    const add = (t, h) => { let s = idx.get(t); if (!s) idx.set(t, (s = new Set())); s.add(h); };
    const attrTemplates = ['Strength', 'Dexterity', 'Intelligence']
      .map((a) => _aggMod.parseLine(`+5 to ${a}`).template);
    for (const [hStr, ls] of Object.entries(statLines)) {
      const h = Number(hStr);
      for (const line of ls) add(_aggMod.parseLine(line).template, h);
      if (nodeMap.get(h)?.attr) for (const t of attrTemplates) add(t, h);
    }
    templateIndex = idx;
    return idx;
  }

  // Recompute and render the left stat panel from the allocated set. Lazily
  // pulls the stat-line artifact + agg module on first use, then re-renders.
  function renderStats() {
    if (!statsListEl) return;
    if (!statLines || !_aggMod) {
      Promise.all([loadStatLines(), aggMod()]).then(() => renderStats()).catch(() => {});
      return;
    }
    // A re-render invalidates the prior data-hl indices, so drop any pending or
    // active hover highlight before rebuilding.
    clearTimeout(hoverTimer); hoverTimer = null; hoverIdx = -1; hoverHits = null;
    buildTemplateIndex();

    if (statsPointsEl && _allocMod) {
      const { main } = _allocMod.pointsSpent(allocated, nodeKindOf);
      statsPointsEl.textContent = main ? `Passive Stats · ${main}` : 'Passive Stats';
    }
    const lines = [];
    for (const h of allocated) {
      const n = nodeMap.get(h);
      if (!n || n.hidden) continue;
      if (n.attr) { lines.push(effectiveAttrLine(h)); continue; }
      const ls = statLines[h];
      if (ls) for (const l of ls) lines.push(l);
    }
    const { categories, uniqueEffects } = _aggMod.aggregate(lines);

    hoverSets = [];
    hoverQueries = [];
    hoverTemplates = [];
    // Register a rendered line's highlight set + pin-to-search query + template,
    // and return the `class`/`data-hl` attributes (data-hl indexes the arrays).
    // The currently pinned template renders with the `.selected` marker.
    const tag = (template) => {
      const set = templateIndex.get(template);
      const i = hoverSets.length;
      hoverSets.push(set && set.size ? set : null);
      hoverQueries.push(_aggMod.templateToQuery(template));
      hoverTemplates.push(template);
      const sel = template === pinnedTemplate ? ' selected' : '';
      return `class="tree-stats-line${sel}" data-hl="${i}"`;
    };

    let html = '';
    for (const cat of categories) {
      html += `<div class="tree-stats-cat"><div class="tree-stats-cat-head">${escHtml(cat.name)}</div>`;
      for (const l of cat.lines) html += `<div ${tag(l.template)}>${numHtml(l.text)}</div>`;
      html += '</div>';
    }
    if (uniqueEffects.length) {
      html += '<div class="tree-stats-cat tree-stats-uniq"><div class="tree-stats-cat-head">Unique Effects</div>';
      for (const u of uniqueEffects) {
        const xn = u.count > 1 ? ` <span class="xn">×${u.count}</span>` : '';
        html += `<div ${tag(u.template)}>${escHtml(u.text)}${xn}</div>`;
      }
      html += '</div>';
    }
    statsListEl.innerHTML = html || '<p class="tree-stats-empty">Allocate nodes to see totals.</p>';
  }

  // Hover a stat line for HOVER_DELAY ms → highlight every matching node. Moving
  // to another line restarts the dwell (debounce); leaving the list clears it.
  function clearStatHover() {
    clearTimeout(hoverTimer); hoverTimer = null; hoverIdx = -1;
    if (hoverHits) { hoverHits = null; requestDraw(); }
  }
  // Drop the pinned-stat marker (the search highlight itself is cleared by the
  // caller). Used on deselect and when the user edits the search box by hand.
  function unmarkSelected() {
    pinnedTemplate = null;
    if (statsListEl) for (const el of statsListEl.querySelectorAll('.tree-stats-line.selected')) el.classList.remove('selected');
  }
  if (statsListEl) {
    statsListEl.addEventListener('pointerover', (e) => {
      const line = e.target.closest('.tree-stats-line[data-hl]');
      if (!line) return;
      const i = Number(line.getAttribute('data-hl'));
      if (i === hoverIdx) return; // same line (e.g. moved onto a .num span)
      hoverIdx = i;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        const set = hoverSets[i];
        if (set && set.size) { hoverHits = set; requestDraw(); }
      }, HOVER_DELAY);
    });
    statsListEl.addEventListener('pointerleave', clearStatHover);

    // Click pins the stat: the matching set moves into the persistent search
    // layer (so it survives the cursor leaving) and the search box is populated
    // with the equivalent query, so the highlight reads as a normal search the
    // user can edit or clear. Hovering other lines still previews over the pin.
    statsListEl.addEventListener('click', (e) => {
      const line = e.target.closest('.tree-stats-line[data-hl]');
      if (!line) return;
      const i = Number(line.getAttribute('data-hl'));
      const set = hoverSets[i];
      if (!set || !set.size) return;
      clearStatHover();
      const tpl = hoverTemplates[i];
      if (tpl && tpl === pinnedTemplate) {
        // Clicking the already-pinned stat toggles it off: clear search + marker.
        unmarkSelected();
        searchHits = null;
        if (searchInput) searchInput.value = '';
      } else {
        // Pin this stat: replace any prior selection + search highlight.
        unmarkSelected();
        pinnedTemplate = tpl;
        line.classList.add('selected');
        searchHits = set;
        if (searchInput) searchInput.value = hoverQueries[i] || '';
      }
      requestDraw();
    });
  }

  // ---------------------------------------------------------------------------
  // Import helpers (passive-alloc + passive-code are sibling ES modules)
  // ---------------------------------------------------------------------------

  // We load alloc + code as ES modules at runtime. They're pure and node-testable.
  // In static build context, the page loads this module; we import the siblings
  // lazily so tests that import only passive-tree.js don't require them.
  let _allocMod = null;
  let _codeMod  = null;
  let _pathMod  = null;

  async function allocMod() {
    if (!_allocMod) _allocMod = await import('./passive-alloc.js');
    return _allocMod;
  }

  async function pathMod() {
    if (!_pathMod) _pathMod = await import('./passive-path.js');
    return _pathMod;
  }

  async function codeMod() {
    if (!_codeMod) _codeMod = await import('./passive-code.js');
    return _codeMod;
  }

  // ---------------------------------------------------------------------------
  // Alloc helpers (synchronous wrappers that use already-loaded modules)
  // ---------------------------------------------------------------------------

  // The pool a click on node `h` spends from: the active weapon set, EXCEPT
  // ascendancy nodes, which are always their own pool (8 pts) and are never
  // weapon-set-specializable — so a weapon set being active never diverts them.
  // Returns 1|2 for a weapon-set allocation, or null for the shared/ascendancy pool.
  function modeFor(h) {
    if (wsMode == null) return null;
    return nodeMap.get(h)?.asc != null ? null : wsMode;
  }

  // We also keep synchronous versions for click handlers after the modules are loaded.
  // Mode-aware: in a weapon-set mode, "can allocate" tests the active set's frontier
  // (but ascendancy nodes always test the shared frontier — see modeFor).
  function _canAllocateSync(h) {
    if (!_allocMod) return false;
    const m = modeFor(h);
    if (m != null) return _allocMod.wsCanAllocate(adj, allocated, starts, wsAlloc[m], h);
    return _allocMod.canAllocate(adj, allocated, starts, h);
  }

  // Any edit invalidates the imported share-code cache so Copy Share Code
  // rebuilds from the current state (otherwise it would re-emit the import as-is).
  function _allocateSync(h) {
    if (!_allocMod) return;
    if (!canAfford([h])) return; // out of points for this pool — no-op
    allocated = _allocMod.allocate(adj, allocated, starts, h);
    decodedState = null;
    pruneAttrChoices();
    clearPathPreview(); // frontier changed → stale preview
    updatePoints();
    requestDraw();
  }

  function _deallocateSync(h) {
    if (!_allocMod) return;
    allocated = _allocMod.deallocate(adj, allocated, starts, h);
    decodedState = null;
    pruneWeaponLayers(); // a shrunk main tree may orphan weapon-set branches
    pruneAttrChoices();
    clearPathPreview(); // frontier changed → stale preview
    updatePoints();
    requestDraw();
  }

  // Allocate/deallocate within the active weapon set (its own 25-pt pool).
  function _wsAllocateSync(h) {
    if (!_allocMod || wsMode == null) return;
    if (!_allocMod.wsCanAfford(wsAlloc[wsMode], 1, budgets().ws)) return; // set full
    const n = nodeMap.get(h);
    if (n && n.attr) attrChoice.set(h, classPrimaryAttr()); // ws attr nodes default like path-alloc
    wsAlloc[wsMode] = _allocMod.wsAllocate(adj, allocated, starts, wsAlloc[wsMode], h);
    decodedState = null;
    clearPathPreview();
    updatePoints();
    requestDraw();
  }

  function _wsDeallocateSync(h) {
    if (!_allocMod || wsMode == null) return;
    wsAlloc[wsMode] = _allocMod.wsDeallocate(adj, allocated, starts, wsAlloc[wsMode], h);
    decodedState = null;
    pruneAttrChoices();
    clearPathPreview();
    updatePoints();
    requestDraw();
  }

  // Re-anchor both weapon-set layers to the (possibly shrunk) shared tree.
  function pruneWeaponLayers() {
    if (!_allocMod) return;
    wsAlloc[1] = _allocMod.pruneWeaponSets(adj, allocated, starts, wsAlloc[1]);
    wsAlloc[2] = _allocMod.pruneWeaponSets(adj, allocated, starts, wsAlloc[2]);
  }

  // Drop attribute picks for nodes no longer allocated anywhere (main or either
  // weapon set) — deallocating (which may cascade) clears the choice, so a fresh
  // allocation re-opens the Str/Int/Dex menu (respec: unallocate, reallocate, re-pick).
  function pruneAttrChoices() {
    for (const h of attrChoice.keys()) {
      if (!allocated.has(h) && !wsAlloc[1].has(h) && !wsAlloc[2].has(h)) attrChoice.delete(h);
    }
  }

  // ---------------------------------------------------------------------------
  // Shortest-path preview + one-click path allocation
  // ---------------------------------------------------------------------------

  // The active class's dominant base attribute — the default for path-allocated
  // generic "+5 to any Attribute" nodes (derived at build time; see classArt).
  function classPrimaryAttr() {
    return (classArt && activeClass && classArt[activeClass]?.attr) || ATTR_DEFAULT;
  }

  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  // Shortest route from the allocated frontier (allocated ∪ starts) to `hash`,
  // through visible/unlocked nodes, fewest points (attr-filler tie-break). Null
  // if the module isn't loaded yet, or the node is already taken / unreachable.
  function computePath(hash) {
    if (!_pathMod) return null;
    const m = modeFor(hash); // ascendancy targets route on the shared pool even in ws mode
    const sources = new Set(allocated);
    for (const s of starts) sources.add(s);
    // For a weapon-set route the active set's nodes also anchor it; the route's
    // new nodes will be allocated into that set, and it must not cross into the
    // ascendancy cluster (which is its own pool).
    if (m != null) for (const h of wsAlloc[m]) sources.add(h);
    return _pathMod.shortestPath(adj, sources, hash, {
      isPathable: (h) => {
        const n = nodeMap.get(h);
        if (!n || !nodeVisible(n)) return false;
        if (m != null && n.asc != null) return false; // ws routes never run through ascendancy
        return true;
      },
      isAttr: (h) => !!nodeMap.get(h)?.attr,
    });
  }

  // The preview/allocation accent for the previewed target's pool (white-gold for
  // shared/ascendancy, the set's colour for a weapon-set route).
  function pathColor() {
    const m = pathTarget != null ? modeFor(pathTarget) : wsMode;
    return m != null ? WS_COLOR[m].path : PATH_COLOR;
  }

  function clearPathPreview() {
    if (!pathNodes) { pathTarget = null; return; }
    pathNodes = pathNodeSet = pathEdgeSet = null;
    pathTarget = null;
    requestDraw();
  }

  // Recompute the preview for the hovered node. No preview for the empty cursor,
  // already-allocated/anchor nodes, or before the path module loads. Recomputes
  // only when the target changes (cheap, but cheaper still to skip).
  // A node the current mode can target with a route: not a shared/anchor node,
  // and (in weapon-set mode) not already in the active set.
  function canTargetForPath(h) {
    if (allocated.has(h) || starts.includes(h)) return false;
    const m = modeFor(h);
    if (m != null) {
      if (wsAlloc[m].has(h)) return false;           // already in the active set
    } else if (wsMode == null && (wsAlloc[1].has(h) || wsAlloc[2].has(h))) {
      return false;                                  // ws node not editable from the shared view
    }
    return true;
  }

  function updatePathPreview(target) {
    if (!_pathMod || !target || !canTargetForPath(target.h)) {
      clearPathPreview();
      return;
    }
    if (target.h === pathTarget) return; // already computed for this node
    const path = computePath(target.h);
    pathTarget = target.h;
    if (!path) { pathNodes = pathNodeSet = pathEdgeSet = null; requestDraw(); return; }
    pathNodes = path;
    pathNodeSet = new Set(path);
    // Edge set: each consecutive pair, plus the entry edge from the frontier node
    // that path[0] hangs off (so the route visibly connects to the allocated tree).
    pathEdgeSet = new Set();
    for (let i = 0; i + 1 < path.length; i++) pathEdgeSet.add(edgeKey(path[i], path[i + 1]));
    const m = modeFor(target.h);
    const inFrontier = (nb) =>
      allocated.has(nb) || starts.includes(nb) || (m != null && wsAlloc[m].has(nb));
    for (const nb of adj.get(path[0]) ?? []) {
      if (inFrontier(nb)) { pathEdgeSet.add(edgeKey(path[0], nb)); break; }
    }
    requestDraw();
  }

  // Allocate every node on the previewed path in order (each becomes allocatable
  // once its predecessor is taken). Generic-attribute nodes default to the class
  // primary attribute; they stay re-pickable via the usual node-click respec.
  function _allocatePathSync(path) {
    if (!_allocMod || !path || !path.length) return;
    const primary = classPrimaryAttr();
    const m = modeFor(path[path.length - 1]); // the target decides the pool
    if (m != null) {
      // Route into the active weapon set's 25-pt pool.
      if (!_allocMod.wsCanAfford(wsAlloc[m], path.length, budgets().ws)) return;
      for (const h of path) {
        const n = nodeMap.get(h);
        if (n && n.attr) attrChoice.set(h, primary);
        wsAlloc[m] = _allocMod.wsAllocate(adj, allocated, starts, wsAlloc[m], h);
      }
    } else {
      if (!canAfford(path)) return; // route doesn't fit the main budget — no-op
      for (const h of path) {
        const n = nodeMap.get(h);
        if (n && n.attr) attrChoice.set(h, primary);
        allocated = _allocMod.allocate(adj, allocated, starts, h);
      }
    }
    decodedState = null;
    clearPathPreview();
    updatePoints();
    requestDraw();
  }

  // ---------------------------------------------------------------------------
  // Draw
  // ---------------------------------------------------------------------------

  function draw() {
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    ctx.save();

    drawCentre();
    drawEdges(W, H);
    drawPathEdges();      // preview route under the node frames (like allocated lines)
    drawNodes(W, H);
    drawPathRings();      // preview node rings + cost label on top

    ctx.restore();
  }

  // Start-position light. GGG packs a second ring sprite, `MainCircleActive`,
  // identical to `MainCircle` but with one cross-in-circle ornament lit (its
  // intricate troughs filled with a baked golden glow) at the top (12 o'clock).
  // To mark the active class's start, GGG draws this overlay rotated so its lit
  // ornament lands on that class's position. We do the same: rotate by the
  // class-start node's angle off the sprite's reference (top = -90°). No
  // hardcoded per-class angles — it's read from the start node's coords.
  const ACTIVE_ORNAMENT_ANGLE = -Math.PI / 2; // lit ornament's baked position (top)
  function drawStartGlow() {
    if (classRoot == null) return;
    const root = nodeMap.get(classRoot);
    if (!root) return;
    const classAngle = Math.atan2(root.y, root.x);
    // The active sprite carries the lit gold clover *and* solid black clovers at
    // the five inactive positions. Drawn normally, those black clovers paint over
    // the base ring's clover holes (hollowing them). GGG composites this layer
    // additively so black adds nothing — only the gold ornament lights up, while
    // the inactive holes keep revealing the stone backing behind the ring.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawSprite('group-background', 'startNode:MainCircleActive', 0, 0, {
      rotate: classAngle - ACTIVE_ORNAMENT_ANGLE,
    });
    ctx.restore();
  }

  // Central illustration (clipped to the frame's inner circle) + the ornate
  // MainCircle frame ring on top, at the tree origin. Shows the active class's
  // art, or — when an ascendancy is selected — that ascendancy's illustration,
  // matching the in-game look where the ascendancy occupies the central ring.
  function drawCentre() {
    const c = worldToScreen(view, 0, 0);
    // Inner clip radius ~ class-start ring; frame native/2 * fill keeps art inside.
    const cf = ATLAS.classFrame;
    const cfAt = atlas('group-background');
    let clipR = 1480 * view.scale; // fallback (~inner-opening radius)
    if (cfAt) {
      const f = cfAt.frames[cf.frame];
      if (f) clipR = (f.frame.w / cfAt.scale) / 2 * CENTER_CLIP_FILL * view.scale;
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(c.x, c.y, clipR, 0, Math.PI * 2);
    ctx.clip();
    if (activeAsc) drawAscArt(c, clipR);
    else drawClassArt(c);
    ctx.restore();

    drawSprite('group-background', cf.frame, 0, 0);
    drawStartGlow();
  }

  // Class illustration: a sprite from the per-class background atlas, drawn at
  // native size centred at origin with GGG's placement offset (world units).
  function drawClassArt(c) {
    const ca = classArt && activeClass ? classArt[activeClass] : null;
    if (!ca) return;
    const at = atlas(`background-${activeClass.toLowerCase()}`);
    if (!at) return;
    const f = at.frames[ca.frame];
    if (!f) return;
    const inv = 1 / at.scale;
    const w = f.frame.w * inv * view.scale;
    const h = f.frame.h * inv * view.scale;
    const ox = (ca.offsetX || 0) * view.scale;
    const oy = (ca.offsetY || 0) * view.scale;
    ctx.drawImage(at.img, f.frame.x, f.frame.y, f.frame.w, f.frame.h,
      c.x - w / 2 + ox, c.y - h / 2 + oy, w, h);
  }

  // Ascendancy illustration: a plain ggpk webp (no atlas). Scaled to cover the
  // ring and centred on origin — GGG's offsetX/Y anchor the art to the cluster's
  // native group centre, which doesn't map to our origin-centred draw, so the
  // illustrations (authored to frame their figure centrally) centre cleanly.
  function drawAscArt(c, clipR) {
    const a = ascendancyArt[activeAsc];
    if (!a || !a.img) return;
    const im = loadImg(a.img);
    if (!im) return;
    const diameter = clipR * 2;
    const scale = diameter / Math.min(im.naturalWidth, im.naturalHeight);
    const w = im.naturalWidth * scale;
    const h = im.naturalHeight * scale;
    ctx.drawImage(im, c.x - w / 2, c.y - h / 2, w, h);
  }

  // Connectors. Straight edges are lines; same-orbit edges are arcs drawn with
  // GGG's precomputed centre/radius/angles (arc.cx/cy/r/a0/a1/ccw) so they sweep
  // along the orbit ring instead of crossing. An unallocated edge is a double
  // rail (see LINE_RAIL_*); an allocated edge (state 'x') fills to a single solid
  // stroke down the centreline.
  function drawEdges(W, H) {
    const off = LINE_RAIL_OFF * view.scale;
    const railW = Math.max(1, LINE_RAIL_W * view.scale);
    const solidW = Math.max(1.4, LINE_SOLID_W * view.scale);
    ctx.lineCap = 'round';
    for (const e of edges) {
      const na = nodeMap.get(e.a), nb = nodeMap.get(e.b);
      if (!na || !nb) continue;
      if (!nodeVisible(na) || !nodeVisible(nb)) continue;
      if ((na.asc != null) !== (nb.asc != null)) continue; // no main↔ascendancy spokes
      // Allocated connectors are solid (main = gold, weapon-set = red/green and
      // always shown); everything else draws as dim/highlighted rails.
      const solidColor = solidConnectorColor(na, nb);
      const solid = solidColor != null;
      ctx.strokeStyle = solid ? solidColor : LINE_COLOR[railState(na, nb)];
      ctx.lineWidth = solid ? solidW : railW;
      ctx.beginPath();
      if (e.arc) {
        const arc = e.arc;
        const c = worldToScreen(view, arc.cx, arc.cy);
        const r = arc.r * view.scale;
        if (c.x + r < 0 || c.x - r > W || c.y + r < 0 || c.y - r > H) continue;
        if (solid) {
          ctx.arc(c.x, c.y, r, arc.a0, arc.a1, arc.ccw);
        } else {
          // Concentric rails: same centre/angles, radius offset in/out.
          ctx.arc(c.x, c.y, r + off, arc.a0, arc.a1, arc.ccw);
          const ri = r - off;
          if (ri > 0.5) {
            ctx.moveTo(c.x + ri * Math.cos(arc.a0), c.y + ri * Math.sin(arc.a0));
            ctx.arc(c.x, c.y, ri, arc.a0, arc.a1, arc.ccw);
          }
        }
      } else {
        const sa = worldToScreen(view, na.x, na.y);
        const sb = worldToScreen(view, nb.x, nb.y);
        if (solid) {
          ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y);
        } else {
          // Perpendicular offset rails either side of the centreline.
          let px = -(sb.y - sa.y), py = sb.x - sa.x;
          const len = Math.hypot(px, py) || 1;
          px = px / len * off; py = py / len * off;
          ctx.moveTo(sa.x + px, sa.y + py); ctx.lineTo(sb.x + px, sb.y + py);
          ctx.moveTo(sa.x - px, sa.y - py); ctx.lineTo(sb.x - px, sb.y - py);
        }
      }
      ctx.stroke();
    }
  }

  function drawNodes(W, H) {
    const cullMargin = 240 * view.scale;
    for (const n of nodes) {
      if (!nodeVisible(n)) continue;
      const sp = worldToScreen(view, n.x, n.y);
      if (sp.x < -cullMargin || sp.x > W + cullMargin ||
          sp.y < -cullMargin || sp.y > H + cullMargin) continue;
      const st = frameState(n);

      // Search highlight: matches keep full alpha + a gold glow; everything else
      // dims so the matches read at a glance. shadowBlur only on the few matches.
      const hl = hoverHits || searchHits;
      if (hl) {
        if (hl.has(n.h)) {
          ctx.globalAlpha = 1;
          ctx.shadowColor = 'rgba(255, 216, 120, 0.95)';
          ctx.shadowBlur = 26 * view.scale;
        } else {
          ctx.globalAlpha = SEARCH_DIM;
          ctx.shadowBlur = 0;
        }
      }

      // Icon (active vs disabled atlas), then frame on top. An allocated
      // generic-attribute node swaps to its chosen stat's dedicated sprite
      // (Str/Dex/Int) — GGG's own art, richer than a colour overlay.
      if (n.icon && n.iconKind) {
        const alloc = st === 'x';
        const icon = (n.attr && alloc) ? (ATTR_ICON[attrOf(n.h)] || n.icon) : n.icon;
        drawSprite(alloc ? 'skills' : 'skills-disabled',
          `${n.iconKind}${alloc ? 'Active' : 'Inactive'}:${icon}`, n.x, n.y);
      }

      const fk = FRAME_KEY[n.k];
      if (fk) drawSprite('frame', `frame:${fk[st]}`, n.x, n.y);

      // Weapon-set ring: a node allocated in a set gets that set's accent ring,
      // always (independent of the editing mode). A node in both sets gets both,
      // at slightly different radii so neither hides the other.
      for (const k of [1, 2]) {
        if (!wsAlloc[k].has(n.h)) continue;
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        ctx.strokeStyle = WS_COLOR[k].line;
        ctx.lineWidth = Math.max(1.5, WS_RING_W * view.scale);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, radiusOf(n.k) * view.scale * (k === 1 ? 0.92 : 1.08), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  // Preview route connectors — bright white-gold over the normal edges, reusing
  // GGG's exact arc/line geometry so the highlight tracks the real connectors.
  function drawPathEdges() {
    if (!pathEdgeSet || !pathEdgeSet.size) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = pathColor();
    ctx.lineWidth = Math.max(2, PATH_LINE_W * view.scale);
    ctx.shadowColor = 'rgba(255, 243, 196, 0.8)';
    ctx.shadowBlur = 12 * view.scale;
    for (const e of edges) {
      if (!pathEdgeSet.has(edgeKey(e.a, e.b))) continue;
      const na = nodeMap.get(e.a), nb = nodeMap.get(e.b);
      if (!na || !nb) continue;
      ctx.beginPath();
      if (e.arc) {
        const arc = e.arc;
        const c = worldToScreen(view, arc.cx, arc.cy);
        ctx.arc(c.x, c.y, arc.r * view.scale, arc.a0, arc.a1, arc.ccw);
      } else {
        const sa = worldToScreen(view, na.x, na.y);
        const sb = worldToScreen(view, nb.x, nb.y);
        ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Preview node rings (one per node that would be allocated) + a "+N pts" pill
  // on the target so the click's cost is visible before committing.
  function drawPathRings() {
    if (!pathNodeSet || !pathNodeSet.size) return;
    ctx.save();
    ctx.strokeStyle = pathColor();
    ctx.lineWidth = Math.max(1.5, PATH_RING_W * view.scale);
    ctx.shadowColor = 'rgba(255, 243, 196, 0.9)';
    ctx.shadowBlur = 16 * view.scale;
    for (const h of pathNodeSet) {
      const n = nodeMap.get(h);
      if (!n) continue;
      const sp = worldToScreen(view, n.x, n.y);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, radiusOf(n.k) * view.scale * 0.92, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    drawPathCost();
  }

  function drawPathCost() {
    if (!pathNodes || !pathNodes.length || pathTarget == null) return;
    const target = nodeMap.get(pathTarget);
    if (!target) return;
    // Font/padding in buffer pixels so the pill reads at a constant CSS size on
    // HiDPI (the drawing buffer is CSS px × devicePixelRatio).
    const dpr = canvas.width / (canvas.clientWidth || canvas.width) || 1;
    const fs = 13 * dpr, padX = 6 * dpr, padY = 3 * dpr;
    const n = pathNodes.length;
    const label = `+${n} pt${n === 1 ? '' : 's'}`;
    const sp = worldToScreen(view, target.x, target.y);
    const r = radiusOf(target.k) * view.scale;
    ctx.save();
    ctx.font = `600 ${fs}px system-ui, -apple-system, sans-serif`;
    const tw = ctx.measureText(label).width;
    const bw = tw + padX * 2, bh = fs + padY * 2;
    const bx = sp.x + r * 0.7, by = sp.y - r * 0.7 - bh;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 4 * dpr);
    else ctx.rect(bx, by, bw, bh);
    ctx.fillStyle = 'rgba(20, 16, 8, 0.85)';
    ctx.fill();
    ctx.strokeStyle = pathColor();
    ctx.lineWidth = Math.max(1, dpr);
    ctx.stroke();
    ctx.fillStyle = pathColor();
    ctx.textBaseline = 'top';
    ctx.fillText(label, bx + padX, by + padY);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Interaction: pan + zoom
  // ---------------------------------------------------------------------------

  let rafId = null;
  function requestDraw() {
    if (!rafId) rafId = requestAnimationFrame(() => { rafId = null; draw(); });
  }

  // Wheel: zoom about the cursor.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    // Anchor in canvas BUFFER pixels, not CSS pixels: the view transform works in
    // buffer space (canvas.width = rect.width * devicePixelRatio), so an unscaled
    // CSS-pixel anchor pulls the zoom toward the top-left on HiDPI displays.
    const mx   = (e.clientX - rect.left) * (canvas.width  / rect.width);
    const my   = (e.clientY - rect.top)  * (canvas.height / rect.height);

    const raw = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    // Clamp to the zoom caps. Derive the factor from the clamped target so the
    // cursor-anchor math below stays exact at the limits (no drift on overshoot).
    const target = Math.min(maxScale, Math.max(minScale, view.scale * raw));
    const factor = target / view.scale;
    if (factor === 1) return; // already at a cap — nothing to do
    // Keep the world point under the cursor stationary.
    view.ox = mx - (mx - view.ox) * factor;
    view.oy = my - (my - view.oy) * factor;
    view.scale = target;
    hideTip();
    requestDraw();
  }, { passive: false });

  // Pointer-drag: pan.
  let dragging  = false;
  let dragStart = { x: 0, y: 0, ox: 0, oy: 0 };
  let dragMoved = false;

  canvas.addEventListener('pointerdown', (e) => {
    dragging  = true;
    dragMoved = false;
    dragStart = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy };
    // Do NOT hide the card here — a press that turns out to be a click must keep
    // the card alive so the node-click can open the attribute picker in it. The
    // card is dismissed only once a real pan begins (in pointermove below).
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      // dragStart/clientX are in CSS pixels, but view.ox/oy live in buffer pixels
      // (canvas.width = rect.width * devicePixelRatio). Scale the delta into buffer
      // space so the grabbed world point tracks the cursor 1:1 — without this the
      // content pans at 1/DPR of cursor speed (sluggish on HiDPI displays).
      const r = canvas.getBoundingClientRect();
      const cssDx = e.clientX - dragStart.x;
      const cssDy = e.clientY - dragStart.y;
      if (!dragMoved && (Math.abs(cssDx) > 3 || Math.abs(cssDy) > 3)) {
        dragMoved = true;
        hideTip(); // a real pan has begun → dismiss the hover card
        clearPathPreview(); // …and the path preview
      }
      if (dragMoved) {
        view.ox = dragStart.ox + cssDx * (canvas.width  / r.width);
        view.oy = dragStart.oy + cssDy * (canvas.height / r.height);
        requestDraw();
      }
      return; // while panning, skip the hover hit-test (don't re-show the card)
    }

    // Hover card: hit-test the node under the cursor, then show its pre-rendered
    // card through the shared Tippy harness anchored at the node.
    const t = ensureTip();
    if (!t) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top)  * (canvas.height / rect.height);
    const wp = screenToWorld(view, mx, my);

    let best = null, bestDist2 = Infinity;
    for (const n of nodes) {
      if (!nodeVisible(n)) continue;
      const r = radiusOf(n.k);
      const dx = n.x - wp.x, dy = n.y - wp.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r && d2 < bestDist2) { best = n; bestDist2 = d2; }
    }

    if (best) {
      clearTimeout(hideTimer);
      // Node centre + radius in viewport CSS pixels for the virtual reference.
      const sp = worldToScreen(view, best.x, best.y);
      const cssScale = rect.width / canvas.width;
      const rr = radiusOf(best.k) * view.scale * cssScale;
      const cx = rect.left + sp.x * cssScale;
      const cy = rect.top  + sp.y * cssScale;
      tipRect = { x: cx - rr, y: cy - rr, w: rr * 2, h: rr * 2 };
      if (best.h !== hoverHash) {
        hoverHash = best.h;
        attrChoosing = null; // new node → start at the resting (generic) view
        loadCards().then((c) => {
          if (hoverHash !== best.h) return; // moved on while the artifact loaded
          t.setContent(c[best.h] || best.name || '');
          t.show();
          if (t.popperInstance) t.popperInstance.update();
          if (best.attr) paintAttrChoice(t.popper, best.h);
        });
      } else if (t.popperInstance) {
        t.popperInstance.update(); // keep anchored while panning
      }
      updatePathPreview(best); // hover route from the allocated frontier
    } else {
      scheduleHide();
      clearPathPreview();
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    const wasDragging = dragMoved;
    dragging  = false;
    dragMoved = false;
    if (wasDragging) return; // pan gesture — skip click logic

    // Hit-test: find node under pointer.
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top)  * (canvas.height / rect.height);
    const wp = screenToWorld(view, mx, my);

    let hit = null, hitDist2 = Infinity;
    for (const n of nodes) {
      if (!nodeVisible(n)) continue;
      const r = radiusOf(n.k);
      const dx = n.x - wp.x, dy = n.y - wp.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r && d2 < hitDist2) { hit = n; hitDist2 = d2; }
    }

    if (!hit) return;

    // Weapon-set editing mode acts on the active set's own pool, never the shared
    // backbone (managed in default mode). Ascendancy nodes are exempt — modeFor()
    // forces them to the shared/ascendancy pool below even with a set active.
    if (modeFor(hit.h) != null) {
      if (wsAlloc[wsMode].has(hit.h)) {
        _wsDeallocateSync(hit.h); // cascades within the set
      } else if (allocated.has(hit.h) || starts.includes(hit.h)) {
        // Shared/anchor node — backbone, not editable from here. No-op.
      } else {
        // Same "route collapses into one click" behaviour, into the set's pool.
        const path = computePath(hit.h);
        if (path && path.length >= 2) _allocatePathSync(path);
        else if (_canAllocateSync(hit.h)) _wsAllocateSync(hit.h);
      }
      return;
    }

    // Default / ascendancy — shared pool (also reached for ascendancy nodes while
    // a weapon set is active, since modeFor() returns null for them).
    if (allocated.has(hit.h)) {
      _deallocateSync(hit.h); // also clears any attribute pick (pruneAttrChoices)
      attrChoosing = null;
    } else if (wsAlloc[1].has(hit.h) || wsAlloc[2].has(hit.h)) {
      // Allocated in a weapon set — edit it from that set's mode, not the shared
      // view (so a shared-mode click can't pull it into the main pool too).
    } else {
      // A multi-node shortest route collapses into a single click (the "fewer
      // clicks" win); attr nodes on it default to the class primary attribute.
      // A length-1 route (target directly adjacent) falls through to the existing
      // single-step behaviour so the attr picker is preserved for adjacent clicks.
      const path = computePath(hit.h);
      if (path && path.length >= 2) {
        _allocatePathSync(path);
      } else if (hit.attr && _canAllocateSync(hit.h)) {
        // Generic-attribute node: a node-body click doesn't allocate — it opens
        // the Str/Int/Dex picker in the card. Allocation happens when the player
        // clicks a specific option (onAttrOptionClick).
        attrChoosing = hit.h;
      } else if (_canAllocateSync(hit.h)) {
        _allocateSync(hit.h);
      }
    }
    // Keep the hovered attribute card in sync (resting/menu/chosen) after the click.
    if (hit.attr && tip && hoverHash === hit.h) paintAttrChoice(tip.popper, hit.h);
  });

  canvas.addEventListener('pointercancel', () => {
    dragging  = false;
    dragMoved = false;
    scheduleHide();
    clearPathPreview();
  });

  canvas.addEventListener('pointerleave', () => {
    // Delay so the cursor can travel into the (interactive) card without it closing.
    scheduleHide();
    clearPathPreview();
  });

  // Resize: keep canvas pixel-matched to its CSS size.
  const ro = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect();
    // Guard against 0×0 (e.g. hidden element during layout).
    if (!rect.width || !rect.height) return;
    const prevW = canvas.width, prevH = canvas.height;
    canvas.width  = rect.width  * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    // Fit exactly once, when real (non-zero) dimensions first arrive. Later
    // resizes (entering/leaving fullscreen, window resize, panel toggle) keep
    // the user's zoom AND keep what they were looking at centred: shift the
    // origin by half the size delta so the previously screen-centred world
    // point stays centred. (Holding ox/oy fixed instead would let the content
    // drift toward a corner — that's the fullscreen "off-centre" bug.)
    if (!fitted) {
      fitView();
      fitted = true;
    } else if (prevW && prevH) {
      view.ox += (canvas.width  - prevW) / 2;
      view.oy += (canvas.height - prevH) / 2;
    }
    requestDraw();
  });
  ro.observe(canvas);

  // ---------------------------------------------------------------------------
  // Weapon-set mode toggle (two buttons: I / II). Default = neither active =
  // shared/main allocation. Clicking a set enters its editing mode; clicking the
  // active set again returns to default. Switching sets is non-destructive.
  // ---------------------------------------------------------------------------

  function setWsMode(mode) {
    wsMode = wsMode === mode ? null : mode;
    for (const b of wsBtns) b.classList.toggle('is-active', Number(b.dataset.wsSet) === wsMode);
    clearPathPreview();   // frontier/pool changed → stale preview
    updatePoints();       // counter "full" flag follows the active pool
    requestDraw();        // re-tint edges/rings for the active set
  }
  for (const b of wsBtns) {
    b.addEventListener('click', () => setWsMode(Number(b.dataset.wsSet)));
  }

  // ---------------------------------------------------------------------------
  // Class / ascendancy selector
  // ---------------------------------------------------------------------------
  // Two <select>s in the controls bar. Class swaps the central art + start
  // anchor (and resets the tree); ascendancy reveals that sub-tree centred on
  // the class start, swapping the central art to the ascendancy illustration.

  const classSel = document.getElementById('tree-class');
  const ascSel   = document.getElementById('tree-ascendancy');

  // Fill the ascendancy <select> for the active class (plus a "none" option).
  function populateAscOptions() {
    if (!ascSel) return;
    const list = ascByClass[activeClass] ?? [];
    ascSel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = list.length ? '— No Ascendancy —' : '— None —';
    ascSel.appendChild(none);
    for (const a of list) {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = a.name;
      ascSel.appendChild(o);
    }
    ascSel.disabled = list.length === 0;
    ascSel.value = activeAsc ?? '';
  }

  // Apply an ascendancy selection: set the anchor, prune nodes from any other
  // ascendancy, redraw. Pass null/'' to clear back to class-only.
  function selectAscendancy(ascId) {
    activeAsc = ascId || null;
    const ascRoot = activeAsc ? ascStarts[activeAsc] : null;
    starts = classRoot != null ? [classRoot] : [];
    if (ascRoot != null) starts.push(ascRoot);
    // Drop allocations belonging to a now-hidden ascendancy.
    const next = new Set();
    for (const h of allocated) {
      const n = nodeMap.get(h);
      if (n && n.asc != null && n.asc !== activeAsc) continue;
      next.add(h);
    }
    allocated = next;
    if (ascSel) ascSel.value = activeAsc ?? '';
    updatePoints();
    requestDraw();
  }

  // Apply a class selection: swap art + start anchor, reset the tree.
  function selectClass(name) {
    if (!ascByClass[name] && !classArt?.[name]) return;
    activeClass = name;
    classRoot = (meta.classStarts ?? {})[name] ?? null;
    activeAsc = null;
    allocated = new Set();
    starts = classRoot != null ? [classRoot] : [];
    decodedState = null;
    if (classSel) classSel.value = name;
    populateAscOptions();
    updatePoints();
    requestDraw();
  }

  if (classSel) {
    classSel.innerHTML = '';
    for (const name of selectableClasses) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      classSel.appendChild(o);
    }
    classSel.value = activeClass;
    classSel.addEventListener('change', () => selectClass(classSel.value));
  }
  populateAscOptions();
  if (ascSel) ascSel.addEventListener('change', () => selectAscendancy(ascSel.value));

  // ---------------------------------------------------------------------------
  // Copy share code
  // ---------------------------------------------------------------------------

  const copyBtn = document.getElementById('tree-copy-code');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        const cm = await codeMod();
        const code = buildShareCode(cm);
        if (!code) { copyBtn.textContent = 'Error'; return; }
        location.hash = code;
        await navigator.clipboard.writeText(location.href);
        const prev = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = prev; }, 1500);
      } catch (err) {
        console.error('Copy share code failed:', err);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Search — highlight matching nodes, dim the rest (name + stat substring).
  // ---------------------------------------------------------------------------

  const searchInput = document.getElementById('tree-search');
  function runSearch(raw) {
    const q = (raw || '').trim().toLowerCase();
    if (!q) { searchHits = null; requestDraw(); return; }
    if (!searchIndex) { loadSearchIndex().then(() => runSearch(raw)); return; }
    const hits = new Set();
    for (const [h, text] of Object.entries(searchIndex)) {
      if (text.includes(q)) hits.add(Number(h));
    }
    searchHits = hits;
    requestDraw();
  }
  if (searchInput) {
    searchInput.addEventListener('focus', loadSearchIndex, { once: true });
    // Typing in the box is a free search — it no longer corresponds to a pinned
    // panel stat, so drop the selection marker before running it.
    searchInput.addEventListener('input', () => { unmarkSelected(); runSearch(searchInput.value); });
  }

  // ---------------------------------------------------------------------------
  // Reset tree — clear allocations back to the current class/ascendancy anchors.
  // ---------------------------------------------------------------------------

  const resetBtn = document.getElementById('tree-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (allocated.size && !window.confirm('Reset the tree? This clears all allocated passives.')) return;
      allocated = new Set();
      attrChoice.clear();
      wsAlloc[1].clear();
      wsAlloc[2].clear();
      wsMode = null;
      for (const b of wsBtns) b.classList.remove('is-active');
      decodedState = null;
      starts = classRoot != null ? [classRoot] : [];
      if (activeAsc != null) {
        const ascRoot = ascStarts[activeAsc];
        if (ascRoot != null) starts.push(ascRoot);
      }
      updatePoints();
      requestDraw();
    });
  }

  // ---------------------------------------------------------------------------
  // Fullscreen — expand the canvas wrapper; the ResizeObserver re-fits the canvas.
  // ---------------------------------------------------------------------------

  const fsBtn = document.getElementById('tree-fullscreen');
  const wrap = canvas.closest('.passive-tree-wrap');
  function syncFsLabel() {
    if (fsBtn) fsBtn.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
  }
  if (fsBtn && wrap) {
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else wrap.requestFullscreen?.().catch((err) => console.error('Fullscreen failed:', err));
    });
    document.addEventListener('fullscreenchange', syncFsLabel);
  }

  // ---------------------------------------------------------------------------
  // Panel collapse — tuck the overlay out of the way (default collapsed on phones).
  // ---------------------------------------------------------------------------

  const panel = document.getElementById('tree-panel');
  const panelToggle = document.getElementById('tree-panel-toggle');
  function syncPanelToggle() {
    if (!panel || !panelToggle) return;
    const collapsed = panel.classList.contains('collapsed');
    panelToggle.textContent = collapsed ? '‹' : '›';
    panelToggle.title = collapsed ? 'Expand' : 'Collapse';
    panelToggle.setAttribute('aria-label', panelToggle.title);
  }
  if (panel && panelToggle) {
    if (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) {
      panel.classList.add('collapsed');
    }
    panelToggle.addEventListener('click', () => {
      panel.classList.toggle('collapsed');
      syncPanelToggle();
    });
    syncPanelToggle();
  }

  // Stats panel collapse — mirror of #tree-panel but docked left, so the toggle
  // chevrons point the other way (‹ collapses it back into the left edge).
  const statsPanel = document.getElementById('tree-stats-panel');
  const statsToggle = document.getElementById('tree-stats-toggle');
  function syncStatsToggle() {
    if (!statsPanel || !statsToggle) return;
    const collapsed = statsPanel.classList.contains('collapsed');
    statsToggle.textContent = collapsed ? '›' : '‹';
    statsToggle.title = collapsed ? 'Expand' : 'Collapse';
    statsToggle.setAttribute('aria-label', `${statsToggle.title} stats`);
  }
  if (statsPanel && statsToggle) {
    if (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) {
      statsPanel.classList.add('collapsed');
    }
    statsToggle.addEventListener('click', () => {
      statsPanel.classList.toggle('collapsed');
      syncStatsToggle();
    });
    syncStatsToggle();
  }

  /**
   * Build a share code from current allocation state.
   * If decodedState is present (imported build), re-encode from it (byte-exact
   * round-trip for imported builds where records are fully known).
   * For freshly allocated trees with no decodedState, we synthesize a minimal
   * records structure. Attribute-node tag words (user's attribute choice) are
   * not recoverable without UI, so those records use tag=null (plain separator).
   * This is a known limitation for fresh allocations — imported builds round-trip
   * exactly; fresh builds omit tag words.
   */
  function buildShareCode(cm) {
    try {
      if (decodedState) {
        // Full round-trip: re-encode the imported state as-is.
        return cm.encode(decodedState);
      }

      // Fresh allocation: synthesize a minimal records structure.
      // charClass: use the decoded one if available, else 10 (default/Mercenary).
      // ascendancy: 0 (no asc UI yet).
      const allocArr = [...allocated];
      const mainRecords = allocArr.map((h) => ({ hash: h, tag: null }));

      // Weapon-set nodes as trailing records (ssType 0x01 + subType 0x02/0x03,
      // matching the codec's weapon-set classification).
      const wsArr = [...wsAlloc[1], ...wsAlloc[2]];
      const trailing = [
        ...[...wsAlloc[1]].map((h) => ({ hash: h, ssType: 0x01, subType: 0x02, tag: null })),
        ...[...wsAlloc[2]].map((h) => ({ hash: h, ssType: 0x01, subType: 0x03, tag: null })),
      ];

      const state = {
        version: 7,
        charClass: 10,
        ascendancy: 0,
        nodes: allocArr,
        weaponSet: wsArr,
        ascNodes: [],
        records: {
          main: mainRecords,
          trailing,
        },
      };
      return cm.encode(state);
    } catch (err) {
      console.error('buildShareCode failed:', err);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Hash import on load
  // ---------------------------------------------------------------------------

  async function importFromHash() {
    const hash = location.hash;
    if (!hash || hash.length <= 1) return;
    const codeStr = hash.slice(1);

    const cm = await codeMod();
    const am = await allocMod();

    let decoded;
    try {
      decoded = cm.decode(codeStr);
    } catch (err) {
      console.warn('[passive-tree] Failed to decode share code:', err);
      return;
    }

    if (decoded.version !== 7) {
      console.warn(`[passive-tree] REJECTED share code: expected version 7, got ${decoded.version}. Refusing to decode unknown format.`);
      return;
    }

    // Derive the active class root from the decoded allocation.
    // Strategy: for each classStarts entry, BFS through adjacency to count how many
    // decoded nodes are reachable from that root. The root with the highest reachable
    // count is the active class.
    const decodedNodeSet = new Set([...decoded.nodes, ...decoded.ascNodes, ...decoded.weaponSet]);
    const classStartEntries = Object.entries(meta.classStarts ?? {});
    let bestRoot = classStartValues[0] ?? null;
    let bestCount = -1;

    for (const [, rootHash] of classStartEntries) {
      const count = countReachableDecoded(rootHash, decodedNodeSet, adj);
      if (count > bestCount) { bestCount = count; bestRoot = rootHash; }
    }

    classRoot = bestRoot;

    // Ascendancy start (if any).
    const ascStarts = meta.ascStarts ?? {};
    let ascRoot = null;
    if (decoded.ascendancy > 0) {
      // ascStarts is ascendancy-id → hash; ascendancy byte is 1-based index.
      // Find the ascendancy start whose start node is reachable in the decoded set.
      for (const [, startHash] of Object.entries(ascStarts)) {
        if (decodedNodeSet.has(startHash) || countReachableDecoded(startHash, decodedNodeSet, adj) > 0) {
          ascRoot = startHash;
          break;
        }
      }
    }

    starts = classRoot != null ? [classRoot] : [];
    if (ascRoot != null && !starts.includes(ascRoot)) starts.push(ascRoot);

    // Route weapon-set records into their per-set pools by subType (0x02 = Set I,
    // 0x03 = Set II); everything else (main + ascendancy nodes) is shared/main.
    const ws = { 1: new Set(), 2: new Set() };
    for (const r of decoded.records?.trailing ?? []) {
      if (r.subType === 0x02) ws[1].add(r.hash);
      else if (r.subType === 0x03) ws[2].add(r.hash);
    }
    const weaponSetHashes = new Set([...ws[1], ...ws[2]]);

    // Mark shared/main nodes as allocated (excluding the class root itself —
    // start nodes are always-present anchors — and the weapon-set nodes).
    const newAllocated = new Set();
    const startSet = new Set(starts);
    for (const h of decodedNodeSet) {
      if (!startSet.has(h) && !weaponSetHashes.has(h)) newAllocated.add(h);
    }
    allocated = newAllocated;
    wsAlloc[1] = ws[1];
    wsAlloc[2] = ws[2];
    wsMode = null;
    for (const b of wsBtns) b.classList.remove('is-active');

    // Keep decoded state for round-trip encode.
    decodedState = decoded;

    // Sync the selector + central art to the imported build. Map the ascendancy
    // start back to its id, then resolve the class (prefer the ascendancy's
    // owner; two classes can share a hexagon start, so the asc disambiguates).
    const ascId = ascRoot != null
      ? Object.keys(ascStarts).find((id) => ascStarts[id] === ascRoot) ?? null
      : null;
    activeAsc = ascId;
    let className = ascId ? ascendancyArt[ascId]?.class : null;
    if (!className) {
      const starts2 = meta.classStarts ?? {};
      className = Object.keys(starts2).find((nm) => starts2[nm] === classRoot && selectableClasses.includes(nm))
        ?? Object.keys(starts2).find((nm) => starts2[nm] === classRoot);
    }
    if (className && (ascByClass[className] || classArt?.[className])) activeClass = className;
    if (classSel) classSel.value = activeClass;
    populateAscOptions();

    updatePoints();
    requestDraw();
  }

  /**
   * Count how many nodes in `targetSet` are reachable from `root` via `adj`,
   * only traversing edges that stay within `targetSet`.
   * Used to identify which class root "owns" a decoded allocation.
   */
  function countReachableDecoded(root, targetSet, adjacency) {
    const seen = new Set();
    const q = [root];
    while (q.length) {
      const cur = q.shift();
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const nb of adjacency.get(cur) ?? []) {
        if ((targetSet.has(nb) || nb === root) && !seen.has(nb)) q.push(nb);
      }
    }
    return seen.size - 1; // exclude root itself
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  const api = {
    /** Set the currently allocated node hashes and trigger a redraw. */
    setAllocated(set) {
      allocated = set instanceof Set ? set : new Set(set);
      requestDraw();
    },
    /** Set which nodes are class/ascendancy start anchors. */
    setStarts(arr) {
      starts = arr;
    },
    /** Force an immediate redraw (e.g. after icon load). */
    redraw: requestDraw,
    view,
    nodeMap,
    data,
  };

  // Atlases load lazily via atlas(); each triggers requestDraw() on load, so no
  // per-node icon preloading is needed.

  // Load alloc + code (+ path) modules eagerly so click handlers have them ready.
  Promise.all([allocMod(), codeMod(), pathMod()]).then(() => {
    // Show the (empty) point counter immediately — "0 / 122 · 0 / 8". A hash
    // import below refreshes it once it decodes its allocations.
    updatePoints();
    // Attempt hash import after modules are ready.
    importFromHash().catch((err) => console.warn('[passive-tree] importFromHash error:', err));
    // Initial draw.
    requestDraw();
  });

  // Initial draw (before modules load — shows the tree immediately).
  requestDraw();

  return api;
}

// ---------------------------------------------------------------------------
// Convenience loader: fetch the artifact and call init.
// ---------------------------------------------------------------------------

/**
 * Fetch the passive-tree artifact and initialize the renderer.
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<ReturnType<typeof init>>}
 */
export async function load(canvas) {
  const res  = await fetch(ARTIFACT_URL);
  if (!res.ok) throw new Error(`Failed to fetch passive tree: ${res.status}`);
  const data = await res.json();
  return init(canvas, data);
}
