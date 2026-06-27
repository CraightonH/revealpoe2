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

const KIND_RADIUS = {
  keystone:   100,
  notable:    67,
  small:      37,
  ascStart:   85,
  ascNotable: 67,
  ascSmall:   37,
  jewel:      56,
};

const KIND_COLOR = {
  keystone:   '#c8a84b',
  notable:    '#8fc8e0',
  small:      '#9090a0',
  ascKS:      '#e0b060',
  ascNotable: '#d0a0d0',
  ascSmall:   '#b090c0',
  classStart: '#ffffff',
  mastery:    '#60c060',
};

const EDGE_COLOR       = '#6a6a86';
const EDGE_COLOR_ASC   = '#9a7cc0';
const EDGE_WIDTH       = 4;

// ---------------------------------------------------------------------------
// Image cache
// ---------------------------------------------------------------------------

const imgCache = new Map(); // url → HTMLImageElement | null (null = error)

function getImage(url) {
  if (imgCache.has(url)) return imgCache.get(url);
  const img = new Image();
  img.src = url;
  img.onerror = () => { imgCache.set(url, null); };
  imgCache.set(url, img);
  return img;
}

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

  // Fit scale so the tree fills ~80% of the smaller canvas dimension.
  // `view` is mutable; it's re-fit by fitView() once real canvas dimensions
  // arrive (the ResizeObserver fires after layout — at init the drawing buffer
  // is still the default 300×150).
  const view = { scale: 1, ox: 0, oy: 0 };
  let fitted = false;

  function fitView() {
    const fitScale = Math.min(
      (canvas.width  * 0.8) / (worldW || 1),
      (canvas.height * 0.8) / (worldH || 1),
    );
    view.scale = fitScale;
    view.ox = canvas.width  / 2 - worldCx * fitScale;
    view.oy = canvas.height / 2 - worldCy * fitScale;
  }

  // Initial fit against whatever the buffer currently is (a reasonable default;
  // corrected by the ResizeObserver's first real-dimension fit).
  fitView();

  // ---------------------------------------------------------------------------
  // Allocation state
  // ---------------------------------------------------------------------------

  // allocated: Set<number> — node hashes the user has allocated.
  // starts: number[] — class root + ascendancy start (always-present anchors, not counted in points).
  // weaponState: Map<number, number> — mask (1=setI, 2=setII, 3=both) for weapon-set nodes.
  // weaponSetMode: boolean — when true, clicks on ws-capable nodes toggle their set instead of alloc/dealloc.
  // decodedState: the last decode() result, kept for round-trip encode().
  let allocated    = new Set();
  let starts       = [];
  let weaponState  = new Map();
  let weaponSetMode = false;
  let decodedState = null;

  // Determine the active class root from meta.classStarts.
  // Default to the first classStarts value on init; overridden on import.
  const classStartValues = Object.values(meta.classStarts ?? {});
  let classRoot = classStartValues[0] ?? null;

  if (classRoot != null) {
    starts = [classRoot];
  }

  // ---------------------------------------------------------------------------
  // Points DOM
  // ---------------------------------------------------------------------------

  const pointsEl  = document.getElementById('tree-points');
  const wsToggle  = document.getElementById('tree-weapon-set');

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
  let tipRect = { x: 0, y: 0, w: 0, h: 0 };
  function ensureTip() {
    if (tip || !window.tippy) return tip;
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    tip = window.tippy(anchor, {
      theme: 'poe2 passive-tree', allowHTML: true, interactive: true, maxWidth: 'none',
      placement: 'right-start', trigger: 'manual', appendTo: () => document.body,
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
      },
    });
    return tip;
  }
  function hideTip() { hoverHash = null; if (tip) tip.hide(); }
  function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (!overTip) hideTip(); }, 160); }

  function nodeKindOf(h) {
    return nodeMap.get(h)?.k ?? '';
  }

  function updatePoints() {
    if (!pointsEl || !_allocMod) return;
    const { main, ascendancy } = _allocMod.pointsSpent(allocated, nodeKindOf);
    const budget = meta.pointBudget ?? 0;
    pointsEl.textContent = budget
      ? `${main} / ${budget} points · ${ascendancy} ascendancy`
      : `${main} points · ${ascendancy} ascendancy`;
  }

  // ---------------------------------------------------------------------------
  // Import helpers (passive-alloc + passive-code are sibling ES modules)
  // ---------------------------------------------------------------------------

  // We load alloc + code as ES modules at runtime. They're pure and node-testable.
  // In static build context, the page loads this module; we import the siblings
  // lazily so tests that import only passive-tree.js don't require them.
  let _allocMod = null;
  let _codeMod  = null;

  async function allocMod() {
    if (!_allocMod) _allocMod = await import('./passive-alloc.js');
    return _allocMod;
  }

  async function codeMod() {
    if (!_codeMod) _codeMod = await import('./passive-code.js');
    return _codeMod;
  }

  // ---------------------------------------------------------------------------
  // Alloc helpers (synchronous wrappers that use already-loaded modules)
  // ---------------------------------------------------------------------------

  // We also keep synchronous versions for click handlers after the modules are loaded.
  function _canAllocateSync(h) {
    if (!_allocMod) return false;
    return _allocMod.canAllocate(adj, allocated, starts, h);
  }

  function _allocateSync(h) {
    if (!_allocMod) return;
    allocated = _allocMod.allocate(adj, allocated, starts, h);
    updatePoints();
    requestDraw();
  }

  function _deallocateSync(h) {
    if (!_allocMod) return;
    allocated = _allocMod.deallocate(adj, allocated, starts, h);
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

    // --- Edges ---
    for (const e of edges) {
      const na = nodeMap.get(e.a);
      const nb = nodeMap.get(e.b);
      if (!na || !nb) continue;

      // Use loose != null so both null and undefined are treated as "no ascendancy".
      const aAsc = na.asc != null;
      const bAsc = nb.asc != null;
      // Skip edges that bridge the main tree and an ascendancy (the class-start →
      // ascendancy-start link), which otherwise draws a long line straight across
      // the whole tree. Ascendancy clusters stay connected via their internal edges.
      if (aAsc !== bAsc) continue;

      const isAsc = aAsc || bAsc;
      ctx.strokeStyle = isAsc ? EDGE_COLOR_ASC : EDGE_COLOR;
      ctx.lineWidth = Math.max(1.5, EDGE_WIDTH * view.scale);

      ctx.beginPath();
      if (e.arc) {
        const arc = e.arc;
        // Convert "up=0, clockwise" convention to canvas "right=0" by subtracting π/2.
        const cx = view.ox + arc.cx * view.scale;
        const cy = view.oy + arc.cy * view.scale;
        const r  = arc.r  * view.scale;
        ctx.arc(cx, cy, r, arc.a0 - Math.PI / 2, arc.a1 - Math.PI / 2, arc.ccw);
      } else {
        const sa = worldToScreen(view, na.x, na.y);
        const sb = worldToScreen(view, nb.x, nb.y);
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
      }
      ctx.stroke();
    }

    // --- Node icons + frames ---
    for (const n of nodes) {
      const sp = worldToScreen(view, n.x, n.y);
      const r  = (KIND_RADIUS[n.k] ?? 26) * view.scale;

      // Icon (lazy-loaded; placeholder until ready).
      if (n.icon) {
        const img = getImage(n.icon);
        if (img && img.complete && img.naturalWidth > 0) {
          const size = r * 2;
          // Clip the square icon to the node circle so its corners don't poke out.
          ctx.save();
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, sp.x - r, sp.y - r, size, size);
          ctx.restore();
        } else {
          // Placeholder circle with kind color.
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, r * 0.7, 0, Math.PI * 2);
          ctx.fillStyle = KIND_COLOR[n.k] ?? '#888';
          ctx.fill();
        }
      }

      // Frame ring by kind.
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = KIND_COLOR[n.k] ?? '#888';
      ctx.lineWidth = Math.max(1, view.scale * 1.5);
      ctx.stroke();

      // Allocation highlight.
      if (allocated.has(n.h)) {
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r + view.scale * 2, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffe066';
        ctx.lineWidth = Math.max(1.5, view.scale * 2);
        ctx.stroke();
      }

      // Start-node indicator (always-present anchors).
      if (starts.includes(n.h)) {
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r + view.scale * 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#44aaff';
        ctx.lineWidth = Math.max(1, view.scale * 1.5);
        ctx.stroke();
      }
    }

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

    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    // Keep the world point under the cursor stationary.
    view.ox = mx - (mx - view.ox) * factor;
    view.oy = my - (my - view.oy) * factor;
    view.scale *= factor;
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
    hideTip();
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
      if (Math.abs(cssDx) > 3 || Math.abs(cssDy) > 3) dragMoved = true;
      view.ox = dragStart.ox + cssDx * (canvas.width  / r.width);
      view.oy = dragStart.oy + cssDy * (canvas.height / r.height);
      requestDraw();
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
      const r = KIND_RADIUS[n.k] ?? 26;
      const dx = n.x - wp.x, dy = n.y - wp.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r && d2 < bestDist2) { best = n; bestDist2 = d2; }
    }

    if (best) {
      clearTimeout(hideTimer);
      // Node centre + radius in viewport CSS pixels for the virtual reference.
      const sp = worldToScreen(view, best.x, best.y);
      const cssScale = rect.width / canvas.width;
      const rr = (KIND_RADIUS[best.k] ?? 33) * view.scale * cssScale;
      const cx = rect.left + sp.x * cssScale;
      const cy = rect.top  + sp.y * cssScale;
      tipRect = { x: cx - rr, y: cy - rr, w: rr * 2, h: rr * 2 };
      if (best.h !== hoverHash) {
        hoverHash = best.h;
        loadCards().then((c) => {
          if (hoverHash !== best.h) return; // moved on while the artifact loaded
          t.setContent(c[best.h] || best.name || '');
          t.show();
          if (t.popperInstance) t.popperInstance.update();
        });
      } else if (t.popperInstance) {
        t.popperInstance.update(); // keep anchored while panning
      }
    } else {
      scheduleHide();
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
      const r = KIND_RADIUS[n.k] ?? 26;
      const dx = n.x - wp.x, dy = n.y - wp.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r && d2 < hitDist2) { hit = n; hitDist2 = d2; }
    }

    if (!hit) return;

    // Weapon-set toggle mode.
    if (weaponSetMode && hit.ws) {
      if (!_allocMod) return;
      weaponState = _allocMod.toggleSet(weaponState, hit.h, 2); // toggle set II
      const mask = _allocMod.setMask(weaponState, hit.h);
      if (mask === 0) {
        allocated = _allocMod.deallocate(adj, allocated, starts, hit.h);
        updatePoints();
      }
      requestDraw();
      return;
    }

    // Normal alloc/dealloc.
    if (allocated.has(hit.h)) {
      _deallocateSync(hit.h);
    } else if (_canAllocateSync(hit.h)) {
      _allocateSync(hit.h);
    }
  });

  canvas.addEventListener('pointercancel', () => {
    dragging  = false;
    dragMoved = false;
    scheduleHide();
  });

  canvas.addEventListener('pointerleave', () => {
    // Delay so the cursor can travel into the (interactive) card without it closing.
    scheduleHide();
  });

  // Resize: keep canvas pixel-matched to its CSS size.
  const ro = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect();
    // Guard against 0×0 (e.g. hidden element during layout).
    if (!rect.width || !rect.height) return;
    canvas.width  = rect.width  * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    // Fit exactly once, when real (non-zero) dimensions first arrive; later
    // resizes keep the user's current pan/zoom.
    if (!fitted) { fitView(); fitted = true; }
    requestDraw();
  });
  ro.observe(canvas);

  // ---------------------------------------------------------------------------
  // Weapon-set mode toggle
  // ---------------------------------------------------------------------------

  if (wsToggle) {
    wsToggle.addEventListener('change', () => {
      weaponSetMode = wsToggle.checked;
    });
  }

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
        await navigator.clipboard.writeText(code);
        location.hash = code;
        const prev = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = prev; }, 1500);
      } catch (err) {
        console.error('Copy share code failed:', err);
      }
    });
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

      const state = {
        version: 7,
        charClass: 10,
        ascendancy: 0,
        nodes: allocArr,
        weaponSet: [],
        ascNodes: [],
        records: {
          main: mainRecords,
          trailing: [],
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

    // Mark all decoded nodes as allocated (excluding the class root itself —
    // start nodes are always-present anchors, not in the allocated pool).
    const newAllocated = new Set();
    const startSet = new Set(starts);
    for (const h of decodedNodeSet) {
      if (!startSet.has(h)) newAllocated.add(h);
    }
    allocated = newAllocated;

    // Keep decoded state for round-trip encode.
    decodedState = decoded;

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

  // Trigger redraws as icons load.
  const drawOnLoad = () => requestDraw();
  for (const n of nodes) {
    if (n.icon) {
      const img = getImage(n.icon);
      if (img && !img.complete) img.addEventListener('load', drawOnLoad, { once: true });
    }
  }

  // Load alloc + code modules eagerly so click handlers have them ready.
  Promise.all([allocMod(), codeMod()]).then(() => {
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
