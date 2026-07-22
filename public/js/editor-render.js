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

import { setupViolations } from './build-rules.js';

/** Granted-skill rows derived from equipped items (amendments §4). */
export function grantedRows(build, planner) {
  const rows = [];
  for (const g of Object.values(build.gear)) {
    if (!g?.item) continue;
    const skills = planner.granted?.[g.item.slug];
    if (!Array.isArray(skills)) continue;
    for (const skill of skills) {
      const key = `${g.item.slug}:${skill}`;
      rows.push({ key, item: g.item, skill, supports: build.grantedSupports?.[key] ?? [] });
    }
  }
  return rows;
}

const SOCKET_COLORS = new Set(['blue', 'green', 'red', 'white']);

function socketHtml(idPrefix, j, supRef, planner) {
  if (!supRef) {
    return `<span class="editor-socket planner-support-socket--empty" data-socket="${esc(`${idPrefix}:${j}`)}"` +
      ' role="button" tabindex="0" aria-label="Empty support socket"></span>';
  }
  const color = planner.gems[supRef.slug]?.color;
  const art = SOCKET_COLORS.has(color) ? color : 'white';
  return `<span class="editor-socket editor-socket--filled planner-support-socket--${esc(art)}"` +
    ` data-socket="${esc(`${idPrefix}:${j}`)}" role="button" tabindex="0" title="${esc(supRef.slug)}"` +
    ` aria-label="Support: ${esc(supRef.slug)}">` +
    `<button class="editor-socket__clear" type="button" data-socket-clear="${esc(`${idPrefix}:${j}`)}" aria-label="Remove support">×</button></span>`;
}

function setupRow({ idPrefix, gemRef, level, supports, label, removable, index, warnings, ctx }) {
  const { planner, resolveRef } = ctx;
  const max = planner.gems[gemRef.slug]?.maxSupports ?? 5;
  const spirit = planner.gems[gemRef.slug]?.gemType === 'spirit';
  const sockets = Array.from({ length: max }, (_, j) => socketHtml(idPrefix, j, supports[j], planner)).join('');
  const levelHtml = removable
    ? `<label class="editor-setup__level planner-gem-level-bg">Lv <input type="number" min="1" max="40"` +
      ` data-setup-level="${index}" value="${level ?? ''}"></label>`
    : '';
  const controls = removable
    ? `<span class="editor-setup__controls">` +
      `<button type="button" data-setup-move="${index}:up" aria-label="Move up">↑</button>` +
      `<button type="button" data-setup-move="${index}:down" aria-label="Move down">↓</button>` +
      `<button type="button" data-setup-remove="${index}" aria-label="Remove setup">×</button></span>`
    : '';
  const gemWell = removable
    ? `<span class="editor-setup__gem planner-gem-icon-frame" data-gem-well="${index}" role="button" tabindex="0">${itemChip(gemRef, resolveRef)}</span>`
    : `<span class="editor-setup__gem planner-gem-icon-frame">${itemChip(gemRef, resolveRef)}</span>`;
  return `<li class="editor-setup planner-skill-frame${spirit ? ' editor-setup--spirit' : ''}">
    ${gemWell}${label}${levelHtml}
    <span class="editor-setup__sockets">${sockets}</span>${controls}
    ${warnings.map((w) => `<p class="editor-setup__warning">${esc(w.message)}</p>`).join('')}
  </li>`;
}

export function renderSkills(build, ctx) {
  const violations = setupViolations(build, ctx.planner.gems);
  const rows = build.skills.map((s, i) => setupRow({
    idPrefix: `s:${i}`, gemRef: s.gem, level: s.level, supports: s.supports,
    label: '', removable: true, index: i,
    warnings: violations.filter((v) => v.setup === i), ctx,
  }));
  const grantedHtml = grantedRows(build, ctx.planner).map((r) => setupRow({
    idPrefix: `g:${r.key}`, gemRef: { kind: 'gem', slug: r.skill }, level: null, supports: r.supports,
    label: `<span class="editor-setup__source">from ${itemChip(r.item, ctx.resolveRef)}</span>`,
    removable: false, index: -1, warnings: [], ctx,
  }));
  return `<section class="editor-skills planner-skill-panel">
    <header class="editor-section-head"><h2>Skills</h2>
      <button class="editor-setup-add" type="button" data-setup-add>Add skill</button></header>
    ${rows.length || grantedHtml.length
      ? `<ul class="editor-setups">${rows.join('')}${grantedHtml.join('')}</ul>`
      : '<p class="editor-none">No skill setups yet.</p>'}
  </section>`;
}

export function renderEditor(build, ctx) {
  const tree = build.tree.code
    ? `Passive tree saved · ${build.tree.notablePriority.length} prioritized`
    : 'No passive tree yet';
  return `<article class="editor" data-editor>
    <header class="editor-head">
      <a class="builds-back" href="#">← All builds</a>
      <h2>${esc(build.name)}</h2>
    </header>
    ${renderGear(build, ctx)}
    ${renderSkills(build, ctx)}
    <section class="editor-tree"><h2>Passive tree</h2>
      <p>${esc(tree)} — <a href="/passives">open the tree</a> (embedding arrives in a later phase).</p></section>
    <section class="editor-notes"><h2>Notes</h2>
      <textarea data-notes rows="4" placeholder="Build notes…">${esc(build.notes)}</textarea></section>
  </article>`;
}
