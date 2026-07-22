// public/js/editor-render.js
// Pure ES module — HTML renderers for the /builds editor ("Dossier" layout,
// 2026-07-22 redesign): document header + section rail, spatial gear doll,
// skill constellation chains, passive-tree summary, description + notes.
// No DOM/fetch/window — node-testable. Interaction hooks are data-*
// attributes consumed by build-editor.js.
import { esc, classLine } from './builds-render.js';
import { gearViolations } from './build-rules.js';
import { decode as decodePassiveCode } from './passive-code.js';

export { esc };

/** "Lightning Arrow" -> "LA" — deterministic icon-fallback initials. */
export function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, 2).map((w) => w[0].toUpperCase()).join('') : '?';
}

/** Icon tile: real art when the doc has one, initials always underneath. */
function tile(doc, name, cls) {
  const img = doc.iconUrl
    ? `<img class="${cls}__img" src="${esc(doc.iconUrl)}" alt="" loading="lazy" onerror="this.remove()">`
    : '';
  return `<span class="${cls}" aria-hidden="true"><span class="${cls}__initials">${esc(initials(name))}</span>${img}</span>`;
}

/** Item chip: icon tile + rarity-colored name, card-tooltip wired. */
function wellBody(ref, resolveRef) {
  const doc = resolveRef(ref) || {};
  const name = doc.name || ref.slug;
  // data-card-url rides the existing global card-tooltip harness (base.njk).
  const card = doc.cardUrl ? ` data-card-url="${esc(doc.cardUrl)}"` : '';
  return `<span class="editor-item"${card}>${tile(doc, name, 'well-tile')}` +
    `<span class="editor-item__name editor-item__name--${esc(ref.kind)}">${esc(name)}</span></span>`;
}

/** Stable partition: docs whose slug is ranked come first, in ranked order. */
export function rankDocs(docs, rankedSlugs) {
  if (!rankedSlugs?.length) return docs;
  const pos = new Map(rankedSlugs.map((s, i) => [s, i]));
  const ranked = docs.filter((d) => pos.has(d.slug)).sort((a, b) => pos.get(a.slug) - pos.get(b.slug));
  return [...ranked, ...docs.filter((d) => !pos.has(d.slug))];
}


export function renderGear(build, ctx) {
  const { planner, resolveRef, weaponSet } = ctx;
  const violations = gearViolations(build, planner);
  const bySlot = new Map(violations.filter((v) => v.slotId).map((v) => [v.slotId, v]));
  const visible = planner.slots.filter((s) => !s.group || s.group === `weaponset${weaponSet}`);
  const mainhand = build.gear[`weapon${weaponSet}a`]?.item;
  const mainTwoHanded = mainhand && planner.items[mainhand.slug]?.twoHanded;
  const ghosted = (s) => s.id === `weapon${weaponSet}b` && mainTwoHanded && !build.gear[s.id]?.item;

  const wells = visible.map((s) => {
    const g = build.gear[s.id];
    const violation = bySlot.get(s.id);
    let body, state;
    if (g?.item) {
      state = g.item.kind === 'unique' ? 'is-unique' : 'is-filled';
      body = `<span class="editor-slot__label">${esc(s.name)}</span>` + wellBody(g.item, resolveRef) +
        `<button class="editor-slot__clear" type="button" data-slot-clear="${esc(s.id)}" aria-label="Unequip ${esc(s.name)}">×</button>`;
    } else if (ghosted(s)) {
      state = 'is-ghost';
      body = `<span class="editor-slot__label">${esc(s.name)}</span><span class="editor-slot__ghost">two-handed</span>`;
    } else {
      state = 'is-empty';
      body = `<span class="editor-slot__hint">＋ ${esc(s.name)}</span>`;
    }
    return `<div class="editor-slot editor-slot--${esc(s.id)} ${state}${violation ? ' editor-slot--violation' : ''}"` +
      ` data-slot-id="${esc(s.id)}" role="button" tabindex="0" aria-label="${esc(s.name)}"` +
      `${violation ? ` title="${esc(violation.message)}"` : ''}>${body}</div>`;
  }).join('');

  const toggle = [1, 2].map((n) =>
    `<button class="editor-set-btn${n === weaponSet ? ' is-active' : ''}" type="button" data-weapon-set="${n}"` +
    ` aria-pressed="${n === weaponSet}">Set ${n === 1 ? 'I' : 'II'}</button>`).join('');

  const checks = [
    ...violations.map((v) => ({ tone: 'is-warn', text: v.message })),
    ...visible.filter((s) => !build.gear[s.id]?.item && !ghosted(s))
      .map((s) => ({ tone: 'is-info', text: `${s.name} is empty.` })),
  ];
  const checksHtml = checks.length
    ? `<ul class="editor-checks">${checks.map((c) => `<li class="${c.tone}">${esc(c.text)}</li>`).join('')}</ul>`
    : '<p class="editor-checks editor-checks--clear">Everything checks out.</p>';

  const tray = build.unassigned.map((ref, i) =>
    `<li class="editor-tray__row">${wellBody(ref, resolveRef)}` +
    `<span class="editor-tray__actions">` +
    `<button type="button" data-tray-equip="${i}">Equip</button>` +
    `<button type="button" data-tray-remove="${i}" aria-label="Remove from build">×</button>` +
    `</span></li>`).join('');

  return `<section class="editor-chapter editor-gear" id="gear" aria-labelledby="gear-h">
    <header class="chapter-head"><h2 id="gear-h">Gear</h2><span class="chapter-rule"></span>
      <div class="editor-set-toggle" role="group" aria-label="Weapon set">${toggle}</div></header>
    <div class="editor-gear-layout">
      <div class="editor-doll-board"><div class="editor-doll">${wells}</div></div>
      <div class="editor-gear-side">
        <div class="editor-side-card"><h3>Checks</h3>${checksHtml}</div>
        <div class="editor-side-card"><h3>Unassigned — added from the wiki</h3>
          ${tray ? `<ul class="editor-tray__list">${tray}</ul>` : '<p class="editor-none">Nothing waiting. Use “Add to build” on any card.</p>'}</div>
      </div>
    </div></section>`;
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

const ORB_COLOR = { r: 'r', g: 'g', b: 'b', w: 'w', red: 'r', green: 'g', blue: 'b', white: 'w' };

function supportNode(idPrefix, j, supRef, ctx) {
  if (!supRef) {
    return `<span class="chain-link chain-link--dim"></span><span class="editor-node editor-node--support">` +
      `<span class="editor-orb editor-orb--empty" data-socket="${esc(`${idPrefix}:${j}`)}"` +
      ` role="button" tabindex="0" aria-label="Empty support socket">＋</span>` +
      `<span class="editor-node__sub">Support</span></span>`;
  }
  const doc = ctx.resolveRef({ kind: 'gem', slug: supRef.slug }) || {};
  const name = doc.name || supRef.slug;
  const color = ORB_COLOR[ctx.planner.gems[supRef.slug]?.color] ?? 'w';
  const card = doc.cardUrl ? ` data-card-url="${esc(doc.cardUrl)}"` : '';
  return `<span class="chain-link"></span><span class="editor-node editor-node--support">` +
    `<span class="editor-orb editor-orb--${color}" data-socket="${esc(`${idPrefix}:${j}`)}"` +
    ` role="button" tabindex="0"${card} aria-label="Support: ${esc(name)}">${tile(doc, name, 'orb-tile')}` +
    `<button class="editor-socket__clear" type="button" data-socket-clear="${esc(`${idPrefix}:${j}`)}" aria-label="Remove support">×</button></span>` +
    `<span class="editor-node__name">${esc(name)}</span></span>`;
}

function chainRow({ idPrefix, gemRef, supports, label, removable, index, warnings, ctx }) {
  const rec = ctx.planner.gems[gemRef.slug] ?? {};
  const max = rec.maxSupports ?? 5;
  const spirit = rec.gemType === 'spirit';
  const doc = ctx.resolveRef(gemRef) || {};
  const name = doc.name || gemRef.slug;
  const card = doc.cardUrl ? ` data-card-url="${esc(doc.cardUrl)}"` : '';
  const sockets = Array.from({ length: max }, (_, j) => supportNode(idPrefix, j, supports[j], ctx)).join('');
  const controls = removable
    ? `<span class="editor-setup__controls">` +
      `<button type="button" data-setup-move="${index}:up" aria-label="Move up">↑</button>` +
      `<button type="button" data-setup-move="${index}:down" aria-label="Move down">↓</button>` +
      `<button type="button" data-setup-remove="${index}" aria-label="Remove setup">×</button></span>`
    : '';
  const orb = `<span class="editor-orb editor-orb--gem"${removable ? ` data-gem-well="${index}" role="button" tabindex="0"` : ''}${card}` +
    ` aria-label="${esc(name)}">${tile(doc, name, 'orb-tile')}</span>`;
  return `<li class="editor-chain${spirit ? ' editor-chain--spirit' : ''}${removable ? '' : ' editor-chain--granted'}">
    <div class="chain-meta">${spirit ? '<span class="chain-spirit">Spirit</span>' : ''}${controls}</div>
    <span class="editor-node editor-node--gem">${orb}<span class="editor-node__name editor-node__name--gem">${esc(name)}</span>${label}</span>
    ${sockets}
    ${warnings.map((w) => `<p class="editor-chain__warning">${esc(w.message)}</p>`).join('')}
  </li>`;
}

export function renderSkills(build, ctx) {
  const violations = setupViolations(build, ctx.planner.gems);
  const rows = build.skills.map((s, i) => chainRow({
    idPrefix: `s:${i}`, gemRef: s.gem, supports: s.supports, label: '', removable: true, index: i,
    warnings: violations.filter((v) => v.setup === i), ctx,
  }));
  const grantedHtml = grantedRows(build, ctx.planner).map((r) => chainRow({
    idPrefix: `g:${r.key}`, gemRef: { kind: 'gem', slug: r.skill }, supports: r.supports,
    label: `<span class="editor-setup__source">from ${wellBody(r.item, ctx.resolveRef)}</span>`,
    removable: false, index: -1, warnings: [], ctx,
  }));
  return `<section class="editor-chapter editor-skills" id="skills" aria-labelledby="skills-h">
    <header class="chapter-head"><h2 id="skills-h">Skills</h2><span class="chapter-rule"></span>
      <button class="editor-setup-add" type="button" data-setup-add>＋ Add skill</button></header>
    ${rows.length || grantedHtml.length
      ? `<ul class="editor-chains">${rows.join('')}${grantedHtml.join('')}</ul>`
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
