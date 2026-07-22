// public/js/editor-render.js
// Pure ES module — HTML renderers for the /builds editor ("Dossier" layout,
// 2026-07-22 redesign): document header + section rail, spatial gear doll,
// skill constellation chains, passive-tree summary, description + notes.
// No DOM/fetch/window — node-testable. Interaction hooks are data-*
// attributes consumed by build-editor.js.
import { esc, classLine } from './builds-render.js';
import { gearViolations } from './build-rules.js';
import { modViolations, resolveMod } from './mod-core.js';
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
  // img first: CSS hides the initials while art is present; onerror removes
  // the img so the initials reappear as the offline/missing fallback.
  return `<span class="${cls}" aria-hidden="true">${img}<span class="${cls}__initials">${esc(initials(name))}</span></span>`;
}

/** Full-bleed item art for a gear well — the icon carries the identity.
    Initials remain the no-art fallback via tile(). */
function wellArt(ref, resolveRef) {
  const doc = resolveRef(ref) || {};
  const name = doc.name || ref.slug;
  return `<span class="editor-item editor-item--art" aria-label="${esc(name)}" title="${esc(name)}">` +
    `${tile(doc, name, 'well-art')}</span>`;
}

/**
 * The chosen-mod blocks for a gear cell, as in-game `.Stats` sections to splice
 * into the item card's `.content` (the controller places them after the level
 * requirements). Each is a leading-separator + `.Stats` block, or '' when empty.
 * `corrupted` is its own separated section (rendered red) so it sits between the
 * requirements and the explicit mod list; `mods` is the explicit prefix/suffix list.
 */
export function modCardSections(cell, pools) {
  const mods = Array.isArray(cell?.mods) ? cell.mods : [];
  // Each explicit mod row is flagged prefix/suffix (P/S) on the left and its
  // tier rank (T1 = top) on the right — build-planner detail the wiki card omits.
  const explicit = mods.map((m) => resolveMod(pools, m)).filter(Boolean)
    .map((m) => `<div class="explicitMod planner-mod${m.origin === 'desecrated' ? ' planner-mod--desecrated' : ''}">` +
      `<span class="planner-mod__kind">${m.gen === 'suffix' ? 'S' : 'P'}</span>` +
      `<span class="planner-mod__text">${esc(m.text)}</span>` +
      `<span class="planner-mod__tier">T${m.tierNum}</span></div>`).join('');
  const corr = cell?.corrupted ? resolveMod(pools, cell.corrupted) : null;
  return {
    corrupted: corr
      ? `<div class="separator"></div><div class="Stats"><div class="explicitMod corruptedMod">${esc(corr.text)}</div></div>`
      : '',
    mods: explicit
      ? `<div class="separator"></div><div class="Stats">${explicit}</div>`
      : '',
  };
}

/** Tiny icon-only chip for the granted "from <item>" tagline — the icon
    identifies, the hover card / title names. */
function sourceChip(ref, resolveRef) {
  const doc = resolveRef(ref) || {};
  const name = doc.name || ref.slug;
  const card = doc.cardUrl ? ` data-card-url="${esc(doc.cardUrl)}"` : '';
  return `<span class="editor-source-chip"${card} aria-label="${esc(name)}" title="${esc(name)}">` +
    `${tile(doc, name, 'source-tile')}</span>`;
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


/** True for the read-only renderings (own-build shared preview + import). */
const isReadonly = (ctx) => !!ctx.mode && ctx.mode !== 'edit';

export function renderGear(build, ctx) {
  const { planner, resolveRef, weaponSet } = ctx;
  const ro = isReadonly(ctx);
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
      const nMods = (g.mods?.length ?? 0) + (g.corrupted ? 1 : 0);
      const indicator = nMods ? `<span class="editor-slot__mods">${nMods} mod${nMods === 1 ? '' : 's'}</span>` : '';
      const modsBtn = ro ? '' : `<button class="editor-slot__mods-edit" type="button" data-mods-edit="${esc(s.id)}" aria-label="Choose modifiers for ${esc(s.name)}">✎ mods</button>`;
      body = wellArt(g.item, resolveRef) + indicator + modsBtn +
        (ro ? '' : `<button class="editor-slot__clear" type="button" data-slot-clear="${esc(s.id)}" aria-label="Unequip ${esc(s.name)}">×</button>`);
    } else if (ghosted(s)) {
      state = 'is-ghost';
      body = `<span class="editor-slot__label">${esc(s.name)}</span><span class="editor-slot__ghost">two-handed</span>`;
    } else {
      state = 'is-empty';
      body = `<span class="editor-slot__hint">${ro ? '' : '＋ '}${esc(s.name)}</span>`;
    }
    const hooks = ro ? '' : ` data-slot-id="${esc(s.id)}" role="button" tabindex="0"`;
    const modsHook = g?.item ? ` data-slot-mods="${esc(s.id)}"` : '';
    return `<div class="editor-slot editor-slot--${esc(s.id)} ${state}${violation ? ' editor-slot--violation' : ''}${ro ? ' is-readonly' : ''}"` +
      `${hooks}${modsHook} aria-label="${esc(s.name)}"` +
      `${violation ? ` title="${esc(violation.message)}"` : ''}>${body}</div>`;
  }).join('');

  const toggle = [1, 2].map((n) =>
    `<button class="editor-set-btn${n === weaponSet ? ' is-active' : ''}" type="button" data-weapon-set="${n}"` +
    ` aria-pressed="${n === weaponSet}">Set ${n === 1 ? 'I' : 'II'}</button>`).join('');

  const checks = [
    ...violations.map((v) => ({ tone: 'is-warn', text: v.message })),
    ...(ctx.pools ? visible.flatMap((s) => {
      const cell = build.gear[s.id];
      if (!cell?.item) return [];
      return modViolations(cell, ctx.pools)
        .map(({ message }) => ({ tone: 'is-warn', text: `${s.name}: ${message}` }));
    }) : []),
    ...visible.filter((s) => !build.gear[s.id]?.item && !ghosted(s))
      .map((s) => ({ tone: 'is-info', text: `${s.name} is empty.` })),
  ];
  const checksHtml = checks.length
    ? `<ul class="editor-checks">${checks.map((c) => `<li class="${c.tone}">${esc(c.text)}</li>`).join('')}</ul>`
    : '<p class="editor-checks editor-checks--clear">Everything checks out.</p>';

  // The tray is a workbench, not part of the build — readers never see it.
  const tray = ro ? '' : build.unassigned.map((ref, i) =>
    `<li class="editor-tray__row">${wellBody(ref, resolveRef)}` +
    `<span class="editor-tray__actions">` +
    `<button type="button" data-tray-equip="${i}">Equip</button>` +
    `<button type="button" data-tray-remove="${i}" aria-label="Remove from build">×</button>` +
    `</span></li>`).join('');
  const trayCard = ro ? '' :
    `<div class="editor-side-card"><h3>Unassigned — added from the wiki</h3>
      ${tray ? `<ul class="editor-tray__list">${tray}</ul>` : '<p class="editor-none">Nothing waiting. Use “Add to build” on any card.</p>'}</div>`;

  // Checks and the tray are editor helpers — read-only renders just the doll.
  const side = ro ? '' : `<div class="editor-gear-side">
        <div class="editor-side-card"><h3>Checks</h3>${checksHtml}</div>
        ${trayCard}
      </div>`;
  return `<section class="editor-chapter editor-gear" id="gear" aria-labelledby="gear-h">
    <header class="chapter-head"><h2 id="gear-h">Gear</h2><span class="chapter-rule"></span>
      <div class="editor-set-toggle" role="group" aria-label="Weapon set">${toggle}</div></header>
    <div class="editor-gear-layout${ro ? ' editor-gear-layout--solo' : ''}">
      <div class="editor-doll-board"><div class="editor-doll">${wells}</div></div>
      ${side}
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
  const ro = isReadonly(ctx);
  if (!supRef) {
    if (ro) return '';   // a viewer only cares about filled sockets
    return `<span class="chain-link chain-link--dim"></span><span class="editor-node editor-node--support">` +
      `<span class="editor-orb editor-orb--empty" data-socket="${esc(`${idPrefix}:${j}`)}"` +
      ` role="button" tabindex="0" aria-label="Empty support socket">＋</span>` +
      `<span class="editor-node__sub">Support</span></span>`;
  }
  const doc = ctx.resolveRef({ kind: 'gem', slug: supRef.slug }) || {};
  const name = doc.name || supRef.slug;
  const color = ORB_COLOR[ctx.planner.gems[supRef.slug]?.color] ?? 'w';
  const card = doc.cardUrl ? ` data-card-url="${esc(doc.cardUrl)}"` : '';
  const hooks = ro ? '' : ` data-socket="${esc(`${idPrefix}:${j}`)}" role="button" tabindex="0"`;
  const clear = ro ? '' :
    `<button class="editor-socket__clear" type="button" data-socket-clear="${esc(`${idPrefix}:${j}`)}" aria-label="Remove support">×</button>`;
  return `<span class="chain-link"></span><span class="editor-node editor-node--support">` +
    `<span class="editor-orb editor-orb--${color}"${hooks}${card} aria-label="Support: ${esc(name)}">${tile(doc, name, 'orb-tile')}` +
    `${clear}</span>` +
    `<span class="editor-node__name">${esc(name)}</span></span>`;
}

function chainRow({ idPrefix, gemRef, supports, label, removable, index, warnings, ctx }) {
  const ro = isReadonly(ctx);
  const rec = ctx.planner.gems[gemRef.slug] ?? {};
  const max = rec.maxSupports ?? 5;
  const spirit = rec.gemType === 'spirit';
  // Setup gem refs are stored as {slug} only — resolve as kind 'gem'.
  const doc = ctx.resolveRef({ kind: 'gem', slug: gemRef.slug }) || {};
  const name = doc.name || gemRef.slug;
  const card = doc.cardUrl ? ` data-card-url="${esc(doc.cardUrl)}"` : '';
  const sockets = Array.from({ length: max }, (_, j) => supportNode(idPrefix, j, supports[j], ctx)).join('');
  const controls = (removable && !ro)
    ? `<span class="editor-setup__controls">` +
      `<button type="button" data-setup-move="${index}:up" aria-label="Move up">↑</button>` +
      `<button type="button" data-setup-move="${index}:down" aria-label="Move down">↓</button>` +
      `<button type="button" data-setup-remove="${index}" aria-label="Remove setup">×</button></span>`
    : '';
  const orb = `<span class="editor-orb editor-orb--gem"${(removable && !ro) ? ` data-gem-well="${index}" role="button" tabindex="0"` : ''}${card}` +
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
    label: `<span class="editor-setup__source">from ${sourceChip(r.item, ctx.resolveRef)}</span>`,
    removable: false, index: -1, warnings: [], ctx,
  }));
  return `<section class="editor-chapter editor-skills" id="skills" aria-labelledby="skills-h">
    <header class="chapter-head"><h2 id="skills-h">Skills</h2><span class="chapter-rule"></span></header>
    ${rows.length || grantedHtml.length
      ? `<ul class="editor-chains">${grantedHtml.join('')}${rows.join('')}</ul>`
      : '<p class="editor-none">No skill setups yet.</p>'}
    ${isReadonly(ctx) ? '' : '<button class="editor-setup-add" type="button" data-setup-add>＋ Add skill setup</button>'}
  </section>`;
}

export function treeSummary(build) {
  if (!build.tree.code) return { saved: false, points: null };
  try {
    const state = decodePassiveCode(build.tree.code);
    // decode() is lenient with garbage bytes — trust only v7 states.
    return { saved: true, points: state.version === 7 ? state.nodes.length : null };
  } catch { return { saved: true, points: null }; }
}

/** Rail build-switcher: current build + popover of every local build. */
function renderSwitcher(build, ctx) {
  const open = !!ctx.switcherOpen;
  const builds = [...(ctx.builds ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
  const rows = builds.map((b) => {
    const items = Object.values(b.gear).filter((g) => g.item).length + b.unassigned.length;
    const current = b.id === ctx.currentId;
    return `<li><a class="build-switcher__row${current ? ' is-current' : ''}" href="#/b/${encodeURIComponent(b.id)}">
      <b>${esc(b.name)}</b>
      <span>${esc(classLine(b))} · ${items} items · ${b.skills.length} setups</span></a></li>`;
  }).join('');
  const pop = open
    ? `<div class="build-switcher__pop">
        <ul class="build-switcher__list">${rows}</ul>
        <button class="build-switcher__new" type="button" data-builds-new>＋ New build</button>
      </div>`
    : '';
  return `<div class="build-switcher" data-switcher>
    <button class="build-switcher__btn" type="button" data-switcher-toggle
      aria-expanded="${open}" aria-haspopup="true" title="Switch build">
      <span class="build-switcher__name">${esc(build.name)}</span><span class="build-switcher__chev" aria-hidden="true">▾</span>
    </button>${pop}</div>`;
}

const titleCase = (slug) => String(slug ?? '').split('-')
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** Class · Ascendancy row: two popover pickers fed by planner.classes. */
function renderClassPicker(build, ctx) {
  const classes = ctx.planner.classes ?? [];
  const cls = classes.find((c) => c.slug === build.class) ?? null;
  const ascName = (cls?.ascendancies ?? []).find((a) => a.slug === build.ascendancy)?.name
    ?? (build.ascendancy ? titleCase(build.ascendancy) : null);
  const open = ctx.classPicker;

  const row = (hook, slug, name, current) =>
    `<li><button class="class-pick__row${current ? ' is-current' : ''}" type="button" ${hook}="${esc(slug)}">${esc(name)}</button></li>`;
  const pop = (which, rows) => open === which
    ? `<ul class="class-pick__pop" role="list">${rows}</ul>` : '';

  const classRows = [
    row('data-set-class', '', 'No class', !build.class),
    ...classes.map((c) => row('data-set-class', c.slug, c.name, c.slug === build.class)),
  ].join('');
  const ascRows = cls ? [
    row('data-set-asc', '', 'No ascendancy', !build.ascendancy),
    ...cls.ascendancies.map((a) => row('data-set-asc', a.slug, a.name, a.slug === build.ascendancy)),
  ].join('') : '';

  return `<div class="dossier-class" data-class-picker>
    <span class="class-pick">
      <button class="class-pick__btn" type="button" data-class-toggle="class"
        aria-expanded="${open === 'class'}" aria-haspopup="true">${esc(cls?.name ?? (build.class ? titleCase(build.class) : 'Choose class'))}<span aria-hidden="true"> ▾</span></button>
      ${pop('class', classRows)}
    </span>
    <span class="dossier-class__sep" aria-hidden="true">·</span>
    <span class="class-pick">
      <button class="class-pick__btn" type="button" data-class-toggle="asc"
        aria-expanded="${open === 'asc'}" aria-haspopup="true"${cls ? '' : ' disabled'}>${esc(ascName ?? 'Ascendancy')}<span aria-hidden="true"> ▾</span></button>
      ${pop('asc', ascRows)}
    </span>
  </div>`;
}

export function renderEditor(build, ctx) {
  const mode = ctx.mode ?? 'edit';
  const ro = mode !== 'edit';
  const t = treeSummary(build);
  const stat = !t.saved ? 'No passive tree saved yet'
    : t.points !== null ? `${t.points} passives allocated` : 'Passive tree saved';
  const prio = build.tree.notablePriority.length;

  const nameHtml = ro
    ? `<span class="dossier-name dossier-name--static">${esc(build.name)}</span>`
    : ctx.renaming
      ? `<input class="dossier-name-input" data-build-name-input type="text" maxlength="60"
          value="${esc(build.name)}" aria-label="Build name" spellcheck="false">`
      : `<button class="dossier-name" type="button" data-build-rename="${esc(build.id)}"
          title="Rename build">${esc(build.name)}<span class="dossier-name__pen" aria-hidden="true">✎</span></button>`;

  const classHtml = ro
    ? `<p class="dossier-class">${esc(classLine(build))}</p>`
    : renderClassPicker(build, ctx);

  const descHtml = ro
    ? (build.description ? `<p class="dossier-desc dossier-desc--static">${esc(build.description)}</p>` : '')
    : `<textarea class="dossier-desc" data-description rows="2"
        placeholder="Add a short description — what this build is and how it plays…">${esc(build.description ?? '')}</textarea>`;

  const actions = {
    edit: `<button class="dossier-share" type="button" data-share>Copy share link</button>
      <button class="dossier-action" type="button" data-view-published>View as shared</button>
      <button class="dossier-action" type="button" data-build-duplicate="${esc(build.id)}">Duplicate</button>
      <button class="dossier-action dossier-action--danger" type="button" data-build-delete="${esc(build.id)}">Delete</button>`,
    view: `<button class="dossier-share" type="button" data-edit-build>← Back to editing</button>
      <button class="dossier-action" type="button" data-share>Copy share link</button>`,
    import: `<button class="dossier-share" type="button" data-import-save>Save a copy</button>`,
  }[mode];

  const banner = mode === 'view'
    ? '<p class="dossier-banner">Shared preview — this is exactly what someone opening your link sees.</p>'
    : mode === 'import'
      ? '<p class="dossier-banner">Shared build preview — not saved in this browser yet.</p>'
      : '';

  const railTop = mode === 'import'
    ? `<span class="build-switcher__name build-switcher__name--static">${esc(build.name)}</span>`
    : renderSwitcher(build, ctx);
  const railNote = mode === 'import'
    ? 'Someone shared this build with you. Save a copy to make it yours.'
    : 'Saved in this browser only. The share link makes this build portable.';

  const treeBody = ro
    ? `<p class="editor-tree-stat">${esc(stat)}${prio ? ` · ${prio} notables prioritized` : ''}</p>
      <a class="editor-tree-open" href="/passives">Open the passive tree →</a>`
    : `<p class="editor-tree-stat">${esc(stat)}${prio ? ` · ${prio} notables prioritized` : ''}</p>
      <label class="editor-tree-code">Tree share code
        <input type="text" data-tree-code spellcheck="false"
          placeholder="Paste a code from the passive tree page…" value="${esc(build.tree.code ?? '')}"></label>
      <a class="editor-tree-open" href="/passives">Open the passive tree →</a>
      <p class="editor-tree-hint">Embedded editing lands in a later phase — for now, build your tree on the tree page and paste its share code here.</p>`;

  const notesBody = ro
    ? (build.notes ? `<div class="editor-notes-static">${esc(build.notes)}</div>`
                   : '<p class="editor-none">No notes.</p>')
    : `<textarea data-notes rows="6" placeholder="Build notes — leveling route, upgrade order, reminders…">${esc(build.notes)}</textarea>`;

  return `<article class="editor dossier${ro ? ' dossier--readonly' : ''}" data-editor>
    <nav class="dossier-rail" aria-label="Build sections">
      <div class="dossier-rail__mark"><span class="dossier-eyebrow">Build Planner</span>
        ${railTop}</div>
      <ol class="dossier-rail__nav">
        <li><a href="#gear" class="is-here" data-rail-link>Gear</a></li>
        <li><a href="#skills" data-rail-link>Skills</a></li>
        <li><a href="#tree" data-rail-link>Passive Tree</a></li>
        <li><a href="#notes" data-rail-link>Notes</a></li>
      </ol>
      <p class="dossier-rail__note">${railNote}</p>
    </nav>
    <div class="dossier-main">
      ${banner}
      <header class="dossier-head">
        <div class="dossier-head__copy">
          <h2>${nameHtml}</h2>
          ${classHtml}
          ${descHtml}
        </div>
        <div class="dossier-actions">${actions}</div>
      </header>
      ${renderGear(build, ctx)}
      ${renderSkills(build, ctx)}
      <section class="editor-chapter editor-tree" id="tree" aria-labelledby="tree-h">
        <header class="chapter-head"><h2 id="tree-h">Passive Tree</h2><span class="chapter-rule"></span></header>
        <div class="editor-tree-band">${treeBody}</div></section>
      <section class="editor-chapter editor-notes" id="notes" aria-labelledby="notes-h">
        <header class="chapter-head"><h2 id="notes-h">Notes</h2><span class="chapter-rule"></span></header>
        ${notesBody}
      </section>
    </div></article>`;
}
