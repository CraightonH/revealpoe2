// public/js/editor-render.js
// Pure ES module — HTML renderers for the /builds editor (Phase 4b): inventory
// paper-doll + tray (this file's renderGear), skill setup panel (renderSkills,
// Task 4), and the assembled renderEditor. No DOM/fetch/window — node-testable.
// In-game art comes from planner-art.css classes; interaction hooks are
// data-* attributes consumed by build-editor.js.
import { esc } from './builds-render.js';
import { gearViolations } from './build-rules.js';

export { esc };

/** Stable partition: docs whose slug is ranked come first, in ranked order. */
export function rankDocs(docs, rankedSlugs) {
  if (!rankedSlugs?.length) return docs;
  const pos = new Map(rankedSlugs.map((s, i) => [s, i]));
  const ranked = docs.filter((d) => pos.has(d.slug)).sort((a, b) => pos.get(a.slug) - pos.get(b.slug));
  return [...ranked, ...docs.filter((d) => !pos.has(d.slug))];
}

function itemChip(ref, resolveRef, cls = '') {
  const doc = resolveRef(ref) || {};
  const name = doc.name || ref.slug;
  const icon = doc.iconUrl
    ? `<img class=\"editor-item__icon\" src=\"${esc(doc.iconUrl)}\" alt=\"\" loading=\"lazy\" onerror=\"this.style.visibility='hidden'\">`
    : '';
  // data-card-url rides the existing global card-tooltip harness (base.njk):
  // hovering a filled well/chip shows the full item card, per the 4b spec.
  const card = doc.cardUrl ? ` data-card-url=\"${esc(doc.cardUrl)}\"` : '';
  return `<span class=\"editor-item ${cls}\"${card}>${icon}<span class=\"editor-item__name editor-item__name--${esc(ref.kind)}\">${esc(name)}</span></span>`;
}

const setOf = (slotId) => (slotId.startsWith('weapon') ? Number(slotId[6]) : null);

export function renderGear(build, ctx) {
  const { planner, resolveRef, weaponSet } = ctx;
  const violations = gearViolations(build, planner);
  const bySlot = new Map(violations.filter((v) => v.slotId).map((v) => [v.slotId, v]));

  const visible = planner.slots.filter((s) => !s.group || s.group === `weaponset${weaponSet}`);
  const mainhand = build.gear[`weapon${weaponSet}a`]?.item;
  const mainTwoHanded = mainhand && planner.items[mainhand.slug]?.twoHanded;

  const wells = visible.map((s) => {
    const g = build.gear[s.id];
    const violation = bySlot.get(s.id);
    let body;
    if (g?.item) {
      body = itemChip(g.item, resolveRef) +
        `<button class=\"editor-slot__clear\" type=\"button\" data-slot-clear=\"${esc(s.id)}\" aria-label=\"Unequip ${esc(s.name)}\">×</button>`;
    } else if (s.id === `weapon${weaponSet}b` && mainTwoHanded) {
      body = '<span class="editor-slot__ghost">two-handed</span>';
    } else {
      body = `<span class=\"editor-slot__hint\">${esc(s.name)}</span>`;
    }
    return `<div class=\"editor-slot planner-slot-well editor-slot--${esc(s.id)}${violation ? ' editor-slot--violation' : ''}\"` +
      ` data-slot-id=\"${esc(s.id)}\" role=\"button\" tabindex=\"0\" aria-label=\"${esc(s.name)}\"` +
      `${violation ? ` title=\"${esc(violation.message)}\"` : ''}>${body}</div>`;
  }).join('');

  const toggle = [1, 2].map((n) =>
    `<button class=\"editor-set-btn${n === weaponSet ? ' is-active' : ''}\" type=\"button\" data-weapon-set=\"${n}\"` +
    ` aria-pressed=\"${n === weaponSet}\">Weapon Set ${n === 1 ? 'I' : 'II'}</button>`).join('');

  const tray = build.unassigned.map((ref, i) =>
    `<li class=\"editor-tray__row\">${itemChip(ref, resolveRef)}` +
    `<span class=\"editor-tray__actions\">` +
    `<button type=\"button\" data-tray-equip=\"${i}\">Equip</button>` +
    `<button type=\"button\" data-tray-remove=\"${i}\" aria-label=\"Remove from build\">×</button>` +
    `</span></li>`).join('');

  const warnings = violations.length
    ? `<ul class=\"editor-warnings\">${violations.map((v) => `<li>${esc(v.message)}</li>`).join('')}</ul>` : '';

  return `<section class=\"editor-gear planner-area-frame\">
    <header class=\"editor-section-head\"><h2>Gear</h2><div class=\"editor-set-toggle\" role=\"group\" aria-label=\"Weapon set\">${toggle}</div></header>
    <div class=\"editor-doll\">${wells}</div>
    ${warnings}
    <div class=\"editor-tray\"><h3>Unassigned</h3>${tray ? `<ul class=\"editor-tray__list\">${tray}</ul>` : '<p class="editor-none">Nothing waiting. Use "Add to build" on any card.</p>'}</div>
  </section>`;
}
