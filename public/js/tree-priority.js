// public/js/tree-priority.js
// Pure ES module — Notable Priority core for the build editor. The priority
// list is *advisory ordering*, not allocation state: reordering never mutates
// the tree. Node-testable; DOM glue (DnD/hover/click/icon paint) lives in
// build-editor.js.
import { esc } from './builds-render.js';

/** Filter prevOrder to still-allocated hashes (order kept), append newly
 *  allocated (in allocated order), dedupe. */
export function reconcilePriority(prevOrder, allocatedHashes) {
  const allocated = new Set(allocatedHashes);
  const seen = new Set();
  const out = [];
  for (const h of prevOrder) if (allocated.has(h) && !seen.has(h)) { seen.add(h); out.push(h); }
  for (const h of allocatedHashes) if (!seen.has(h)) { seen.add(h); out.push(h); }
  return out;
}

/**
 * Which gap a drop at (x, y) targets, as an index into the CURRENT order —
 * 0 = before the first tile, order.length = after the last. `rects` are the
 * tiles' bounding boxes, in order.
 *
 * The list wraps, so this scores by row first (vertical distance dominates) and
 * then by horizontal distance to a tile's midpoint. That makes the whole strip
 * a drop target rather than just the tiles themselves: releasing in the empty
 * space right of the last tile on a line lands after that tile, and past the
 * final tile appends — which "drop must land on a tile" could never express, so
 * the drag just snapped back.
 */
export function insertionIndex(rects, x, y) {
  if (!rects.length) return 0;
  let best = 0;
  let bestScore = Infinity;
  rects.forEach((r, i) => {
    const mid = r.left + r.width / 2;
    const dy = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
    // Row mismatch outweighs any horizontal distance within a row.
    const score = dy * 10000 + Math.abs(x - mid);
    if (score < bestScore) { bestScore = score; best = x < mid ? i : i + 1; }
  });
  return best;
}

/**
 * `hash` moved to the gap at `index` (an index into the pre-move array).
 * Returns the same array reference when nothing moves, so callers can skip a
 * pointless write. Never mutates the input.
 */
export function moveTo(order, hash, index) {
  const from = order.indexOf(hash);
  if (from < 0) return order;
  // Removing the dragged tile first shifts every later gap down by one.
  const to = Math.max(0, Math.min(index > from ? index - 1 : index, order.length - 1));
  if (to === from) return order;
  const next = [...order];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

const KIND_LABEL = { keystone: 'Keystone', notable: 'Notable', ascNotable: 'Ascendancy', blighted: 'Notable' };

export function renderPriorityList(order, metaByHash, opts = {}) {
  const ro = !!opts.readonly;
  if (!order.length) {
    return '<p class="editor-none">No notables allocated yet — allocate keystones and notables in the tree above.</p>';
  }
  // Square icon tiles flowing left-to-right (reading order = priority order),
  // wrapping to new lines — a compact "constellation" read rather than a stack
  // of full-width rows. The name lives in the tooltip/aria-label; the kind tints
  // the tile border.
  const rows = order.map((h) => {
    const m = metaByHash.get(h) || {};
    const kind = m.kind || 'notable';
    const name = m.name || String(h);
    const label = `${name} — ${KIND_LABEL[kind] || 'Notable'}`;
    const handle = ro ? '' : '<span class="prio-handle" aria-hidden="true">⠿</span>';
    const remove = ro ? '' : `<button type="button" class="prio-remove" data-prio-remove="${h}" aria-label="Remove ${esc(name)} from priority">×</button>`;
    return `<li class="prio-tile is-${esc(kind)}" data-prio-row="${h}"${ro ? '' : ' draggable="true"'}` +
      ` title="${esc(label)}" aria-label="${esc(label)}">` +
      `${handle}` +
      `<canvas class="prio-icon" data-prio-icon="${h}" width="44" height="44" aria-hidden="true"></canvas>` +
      `${remove}</li>`;
  }).join('');
  return `<ol class="prio-list"${ro ? '' : ' data-prio-dnd'}>${rows}</ol>`;
}
