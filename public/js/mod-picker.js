// public/js/mod-picker.js
// Anchored popover for choosing a gear slot's modifiers. Selection/HTML logic
// lives in the pure mod-core (node-tested); this file is DOM glue only.
import { poolsForBase, corruptedForRef, modPickerHtml, resolveMod } from '/static/js/mod-core.js';

let current = null;
export function closeModPicker() {
  current?.el.remove();
  if (current) document.removeEventListener('keydown', current.onKey);
  current = null;
}

function viewFor(ref, pools) {
  if (ref.kind === 'unique') return { prefix: [], suffix: [], corrupted: corruptedForRef(pools, ref), mode: 'unique' };
  const p = poolsForBase(pools, ref.slug);
  return { ...p, mode: 'base' };
}

// First tier id offered for a freshly added affix (top/highest available tier).
function defaultTier(view, affix) {
  const fam = [...view.prefix, ...view.suffix, ...view.corrupted].find((f) => f.affix === affix);
  return fam?.tiers[fam.tiers.length - 1]?.id ?? null;
}

export function openModPicker({ anchorEl, ref, cell, pools, onChange }) {
  closeModPicker();
  const view = viewFor(ref, pools);
  const el = document.createElement('div');
  el.className = 'mod-picker-pop';
  const onKey = (e) => { if (e.key === 'Escape') closeModPicker(); };
  current = { el, onKey, cell };
  document.addEventListener('keydown', onKey);

  const rerender = () => { el.innerHTML = modPickerHtml(view, current.cell); position(); };
  const emit = (next) => { current.cell = next; onChange(next); rerender(); };

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-mod-close]')) { closeModPicker(); return; }
    const add = e.target.closest('[data-mod-add]')?.getAttribute('data-mod-add');
    if (add) {
      const c = current.cell;
      if (ref.kind === 'unique') { emit({ ...c, corrupted: { affix: add, tier: defaultTier(view, add) } }); return; }
      if ((c.mods ?? []).some((m) => m.affix === add)) return;   // one row per family
      emit({ ...c, mods: [...(c.mods ?? []), { affix: add, tier: defaultTier(view, add) }] });
      return;
    }
    const rm = e.target.closest('[data-mod-remove]')?.getAttribute('data-mod-remove');
    if (rm) {
      const c = current.cell;
      if (ref.kind === 'unique') emit({ ...c, corrupted: null });
      else emit({ ...c, mods: (c.mods ?? []).filter((m) => m.affix !== rm) });
    }
  });
  el.addEventListener('change', (e) => {
    const affix = e.target.closest('[data-mod-tier]')?.getAttribute('data-mod-tier');
    if (!affix) return;
    const c = current.cell;
    if (ref.kind === 'unique') emit({ ...c, corrupted: { affix, tier: e.target.value } });
    else emit({ ...c, mods: (c.mods ?? []).map((m) => (m.affix === affix ? { ...m, tier: e.target.value } : m)) });
  });
  el.addEventListener('input', (e) => {
    if (!e.target.matches('.mod-picker__search')) return;
    const q = e.target.value.trim().toLowerCase();
    el.querySelectorAll('.mod-picker__col .mod-picker__row').forEach((row) => {
      row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  function position() {
    const r = anchorEl.getBoundingClientRect();
    el.style.top = `${window.scrollY + r.bottom + 6}px`;
    el.style.left = `${Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - 360)}px`;
  }
  document.body.append(el);
  rerender();
  el.querySelector('.mod-picker__search')?.focus();
}
