// Site-wide delegated handler for the "Add to build" card affordance
// (data-add-build-kind/-slug, emitted by views/macros/card-actions.njk).
// Pattern: trade-link.js, upgraded to a picker menu because the action needs
// a target build. Also exports openBuildMenu for programmatic callers
// (theorycraft pin-tray promote).
import { getStore } from '/static/js/build-host.js';
import { StoreWriteError, LIMITS } from '/static/js/build-store.js';

let menu = null;
function closeMenu() { menu?.remove(); menu = null; }

function toast(html) {
  document.querySelector('.build-toast')?.remove();
  const el = document.createElement('div');
  el.className = 'build-toast';
  el.setAttribute('role', 'status');
  el.innerHTML = html;
  document.body.append(el);
  setTimeout(() => el.remove(), 5000);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function addRefs(buildId, refs) {
  const store = getStore();
  const b = store.get(buildId);
  if (!b) return;
  const have = new Set([...b.unassigned, ...Object.values(b.gear).map((g) => g.item).filter(Boolean)]
    .map((r) => `${r.kind}:${r.slug}`));
  const fresh = refs.filter((r) => !have.has(`${r.kind}:${r.slug}`));
  if (!fresh.length) return;
  // The tray is a staging area, not a collection: bound it so a run of
  // "add to build" clicks across the site can't grow one build without limit.
  const room = LIMITS.unassigned - b.unassigned.length;
  if (room <= 0) {
    window.alert(`This build's unassigned tray is full (${LIMITS.unassigned} items). `
      + 'Equip or remove some before adding more.');
    return;
  }
  store.update(buildId, { unassigned: [...b.unassigned, ...fresh.slice(0, room)] });
  const openLink = `<a href="/builds#/b/${encodeURIComponent(buildId)}">open</a>`;
  toast(fresh.length
    ? `Added ${fresh.length === 1 ? '' : fresh.length + ' items '}to <strong>${esc(b.name)}</strong> — ${openLink}`
    : `Already in <strong>${esc(b.name)}</strong> — ${openLink}`);
}

export function openBuildMenu(anchor, refs) {
  closeMenu();
  const store = getStore();
  const builds = store.list();
  menu = document.createElement('div');
  menu.className = 'build-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = builds.map((b) =>
    `<button type="button" role="menuitem" data-menu-build="${esc(b.id)}">${esc(b.name)}</button>`).join('') +
    '<button type="button" role="menuitem" data-menu-new>New build…</button>';
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.round(r.bottom + window.scrollY + 4)}px`;
  menu.style.left = `${Math.round(Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - menu.offsetWidth - 8))}px`;
  menu.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-menu-build]');
    const isNew = e.target.closest('[data-menu-new]');
    if (!pick && !isNew) return;
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
    try {
      const id = pick ? pick.getAttribute('data-menu-build') : store.create().id;
      addRefs(id, refs);
    } catch (err) {
      if (err instanceof StoreWriteError) return toast(`Couldn't save — browser storage is full.`);
      throw err;
    }
  });
  menu.querySelector('button')?.focus();
}

function refFor(el) {
  return { kind: el.getAttribute('data-add-build-kind'), slug: el.getAttribute('data-add-build-slug') };
}

function activate(e) {
  const el = e.target.closest('[data-add-build-kind]');
  if (!el) return false;
  e.preventDefault();
  e.stopPropagation();
  openBuildMenu(el, [refFor(el)]);
  return true;
}

document.addEventListener('click', (e) => {
  if (menu && !e.target.closest('.build-menu')) { const was = activate(e); if (!was) closeMenu(); return; }
  activate(e);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return closeMenu();
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  if (e.target.closest && e.target.closest('[data-add-build-kind]')) activate(e);
});
