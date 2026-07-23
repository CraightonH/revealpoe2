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

const KIND_LABEL = { keystone: 'Keystone', notable: 'Notable', ascNotable: 'Ascendancy', blighted: 'Notable' };

export function renderPriorityList(order, metaByHash, opts = {}) {
  const ro = !!opts.readonly;
  if (!order.length) {
    return '<p class="editor-none">No notables allocated yet — allocate keystones and notables in the tree above.</p>';
  }
  const rows = order.map((h) => {
    const m = metaByHash.get(h) || {};
    const kind = m.kind || 'notable';
    const name = m.name || String(h);
    const handle = ro ? '' : '<span class="prio-handle" aria-hidden="true">⠿</span>';
    const remove = ro ? '' : `<button type="button" class="prio-remove" data-prio-remove="${h}" aria-label="Remove ${esc(name)} from priority">×</button>`;
    return `<li class="prio-row" data-prio-row="${h}"${ro ? '' : ' draggable="true"'}>` +
      `${handle}` +
      `<canvas class="prio-icon" data-prio-icon="${h}" width="28" height="28" aria-hidden="true"></canvas>` +
      `<span class="prio-body"><span class="prio-name is-${esc(kind)}">${esc(name)}</span>` +
      `<span class="prio-kind">${esc(KIND_LABEL[kind] || 'Notable')}</span></span>` +
      `${remove}</li>`;
  }).join('');
  return `<ol class="prio-list"${ro ? '' : ' data-prio-dnd'}>${rows}</ol>`;
}
