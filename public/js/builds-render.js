// public/js/builds-render.js
// Pure ES module — HTML renderers for the /builds surface (list, read-only
// viewer, import preview). No DOM access, no fetch: node-testable
// (query-core.js pattern). The controller (builds-page.js) owns wiring.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** '#/b/<id>' -> build view, '#/import/<code>' -> import view, else list. */
export function parseRoute(hash) {
  const h = String(hash ?? '').replace(/^#/, '');
  if (h.startsWith('/b/')) {
    const id = decodeURIComponent(h.slice(3));
    if (id) return { view: 'build', id };
  }
  if (h.startsWith('/import/')) {
    const code = h.slice('/import/'.length);
    if (code) return { view: 'import', code };
  }
  return { view: 'list' };
}

const titleCase = (slug) => String(slug ?? '').split('-')
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const classLine = (b) => [b.class, b.ascendancy].filter(Boolean).map(titleCase).join(' · ') || 'No class chosen';

const dateLine = (ms) => new Date(ms).toISOString().slice(0, 10);

function refHtml(ref, resolveRef) {
  const doc = resolveRef(ref) || {};
  const name = doc.name || ref.slug;
  const icon = doc.iconUrl
    ? `<img class="builds-ref__icon" src="${esc(doc.iconUrl)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : '';
  const inner = `${icon}<span class="builds-ref__name builds-ref__name--${esc(ref.kind)}">${esc(name)}</span>`;
  return doc.url ? `<a class="builds-ref" href="${esc(doc.url)}">${inner}</a>`
                 : `<span class="builds-ref">${inner}</span>`;
}

export function renderList(builds) {
  const newBtn = '<button class="builds-new" type="button" data-builds-new>New build</button>';
  if (!builds.length) {
    return `<div class="builds-empty">
      <h2>No builds yet</h2>
      <p>Builds are saved in this browser only. Create one here, or use the
      “Add to build” icon on any gem, unique, or base item card.</p>
      ${newBtn}</div>`;
  }
  const rows = builds.map((b) => {
    const items = Object.values(b.gear).filter((g) => g.item).length + b.unassigned.length;
    return `<li class="builds-row">
      <a class="builds-row__open" href="#/b/${encodeURIComponent(b.id)}">
        <span class="builds-row__name">${esc(b.name)}</span>
        <span class="builds-row__meta">${esc(classLine(b))} — ${items} items · ${b.skills.length} skill setups</span>
        <span class="builds-row__date">updated ${esc(dateLine(b.updatedAt))}</span>
      </a>
      <span class="builds-row__actions">
        <button type="button" data-build-rename="${esc(b.id)}">Rename</button>
        <button type="button" data-build-duplicate="${esc(b.id)}">Duplicate</button>
        <button type="button" data-build-delete="${esc(b.id)}">Delete</button>
      </span></li>`;
  }).join('');
  return `<div class="builds-list-head">${newBtn}</div><ul class="builds-list">${rows}</ul>`;
}

function sections(b, resolveRef) {
  const gear = Object.entries(b.gear).filter(([, g]) => g.item)
    .map(([slot, g]) => `<li class="builds-slot"><span class="builds-slot__label">${esc(titleCase(slot))}</span>${refHtml(g.item, resolveRef)}</li>`);
  const unassigned = b.unassigned.map((ref) => `<li>${refHtml(ref, resolveRef)}</li>`);
  const skills = b.skills.map((s) => {
    const sups = s.supports.map((sup) => `<li>${refHtml({ kind: 'gem', slug: sup.slug }, resolveRef)}</li>`).join('');
    const lvl = s.level ? ` <span class="builds-setup__level">Lv ${esc(s.level)}</span>` : '';
    return `<li class="builds-setup">${refHtml({ kind: 'gem', slug: s.gem.slug }, resolveRef)}${lvl}
      ${sups ? `<ul class="builds-setup__supports">${sups}</ul>` : ''}</li>`;
  });
  const tree = b.tree.code
    ? `Passive tree saved · ${b.tree.notablePriority.length} prioritized`
    : 'No passive tree yet';
  const sec = (title, body) => `<section class="builds-section"><h2>${title}</h2>${body}</section>`;
  return [
    sec('Gear', gear.length ? `<ul class="builds-gear">${gear.join('')}</ul>` : '<p class="builds-none">Nothing equipped.</p>'),
    unassigned.length ? sec('Unassigned items', `<ul class="builds-unassigned">${unassigned.join('')}</ul>`) : '',
    sec('Skills', skills.length ? `<ul class="builds-setups">${skills.join('')}</ul>` : '<p class="builds-none">No skill setups.</p>'),
    sec('Passive tree', `<p>${esc(tree)}</p>`),
    b.notes ? sec('Notes', `<p class="builds-notes">${esc(b.notes)}</p>`) : '',
  ].join('');
}

/** Read-only build viewer (editing arrives in Phase 4b). */
export function renderBuild(b, resolveRef) {
  return `<article class="builds-viewer">
    <header class="builds-viewer__head">
      <a class="builds-back" href="#">← All builds</a>
      <h2>${esc(b.name)}</h2>
      <p class="builds-viewer__class">${esc(classLine(b))}</p>
    </header>
    ${sections(b, resolveRef)}</article>`;
}

/** Import preview: decode states for #/import/<code>. */
export function renderImport(state, resolveRef) {
  if (state.status === 'loading') return '<div class="builds-import"><p>Decoding shared build…</p></div>';
  if (state.status === 'error') {
    return `<div class="builds-import builds-import--error">
      <h2>This share link didn’t decode</h2><p>${esc(state.message)}</p>
      <p><a href="#">Back to your builds</a></p></div>`;
  }
  const b = state.build;
  return `<div class="builds-import">
    <p class="builds-import__banner">Shared build preview — not saved to your browser yet.
      <button type="button" data-import-save>Save a copy</button></p>
    ${renderBuild(b, resolveRef)}</div>`;
}
