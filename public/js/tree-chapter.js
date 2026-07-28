// public/js/tree-chapter.js
// Fills the build editor's Passive Tree chapter — the points strip and the
// Notable Priority list — from a live tree embed.
//
// Shared by BOTH hosts so the chapter looks the same everywhere: the editor's
// interactive embed (build-editor.js) and the read-only preview behind "View" /
// a shared #/import/ link (build-editor.js + builds-page.js). The read-only
// renders pass readonly:true, which drops the drag handles and remove buttons —
// the list is informational there, not reorderable.
import { reconcilePriority, renderPriorityList } from './tree-priority.js';

/** "5 / 122 Passives · 0 / 8 Ascendancy" as chips. Pure. */
export function pointsChipsHtml(points) {
  if (!points) return '';
  const chip = (label, o) => (o
    ? `<span class="tree-chip"><b>${o.spent}</b>${o.max != null ? ` / ${o.max}` : ''} <span>${label}</span></span>`
    : '');
  return chip('Passives', points.main)
    + (points.asc?.spent ? chip('Ascendancy', points.asc) : '')
    + (points.ws1?.spent ? chip('Set I', points.ws1) : '')
    + (points.ws2?.spent ? chip('Set II', points.ws2) : '');
}

/**
 * The allocated-notable metadata and the build's priority order, read off a
 * live embed. `reconcilePriority` drops hashes the build no longer allocates
 * and appends ones it gained, so a stale saved order never shows ghosts.
 */
export function chapterState(api, build) {
  const meta = new Map((api?.getAllocatedNotables?.() ?? [])
    .map((n) => [n.h, { kind: n.kind, name: n.name, icon: n.icon }]));
  return { meta, order: reconcilePriority(build?.tree?.notablePriority || [], [...meta.keys()]) };
}

/**
 * Paint the chapter inside `root`. Missing hooks are skipped, so a mode that
 * renders only part of the chapter is safe to pass through here.
 */
export function fillTreeChapter(root, api, { order, meta, readonly = false } = {}) {
  if (!root) return;
  const summary = root.querySelector('[data-tree-points-summary]');
  if (summary && api) summary.innerHTML = pointsChipsHtml(api.getPoints?.());
  const box = root.querySelector('[data-notable-priority]');
  if (!box) return;
  box.innerHTML = '<h3 class="editor-subhead">Notable Priority</h3>'
    + renderPriorityList(order ?? [], meta ?? new Map(), { readonly });
  // The tile art is drawn from the embed's sprite atlas, so it can only be
  // painted once the embed exists.
  for (const c of box.querySelectorAll('[data-prio-icon]')) {
    api?.paintNodeIcon?.(Number(c.getAttribute('data-prio-icon')), c);
  }
}
