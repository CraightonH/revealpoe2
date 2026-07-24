// Site-wide delegated handler for the "Add to Theory Craft" pin affordance
// (data-pin-kind/-slug/-class, emitted by views/macros/card-actions.njk).
// Mirrors trade-link.js / add-to-build.js. Pins land in the shared tcPins store;
// /theorycraft resolves + renders them (recovering the fine gem/support/spirit
// category from the coarse 'gem' kind — see pin-store.js resolve()). Add-only
// with an idempotent toast: there is no persistent pinned-state indicator off
// /theorycraft (the fine category — and thus true pinned state for gems — is
// unknown without the search index).
import { createPinStore } from '/static/js/pin-store.js';

const store = createPinStore();

function toast(html) {
  document.querySelector('.build-toast')?.remove();
  const el = document.createElement('div');
  el.className = 'build-toast';
  el.setAttribute('role', 'status');
  el.innerHTML = html;
  document.body.append(el);
  setTimeout(() => el.remove(), 5000);
}

function refFor(el) {
  const ref = { category: el.getAttribute('data-pin-kind'), slug: el.getAttribute('data-pin-slug') };
  const classSlug = el.getAttribute('data-pin-class');
  if (classSlug) ref.classSlug = classSlug;
  return ref;
}

function activate(e) {
  const el = e.target.closest('[data-pin-kind]');
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  const added = store.add(refFor(el));
  const link = '<a href="/theorycraft">Theory Craft</a>';
  toast(added ? `Pinned to ${link}` : `Already pinned — view on ${link}`);
}

document.addEventListener('click', activate);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  if (e.target.closest && e.target.closest('[data-pin-kind]')) activate(e);
});
