// public/js/mod-picker.js
// Anchored popover for choosing a gear slot's modifiers. Selection/HTML logic
// lives in the pure mod-core (node-tested); this file is DOM glue only.
import { poolsForBase, corruptedForRef, modPickerHtml, resolveMod } from '/static/js/mod-core.js';

let current = null;
export function closeModPicker() {
  current?.el.remove();
  if (current) {
    document.removeEventListener('keydown', current.onKey);
    document.removeEventListener('pointerdown', current.onDocDown, true);
  }
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
  const slotId = anchorEl.getAttribute('data-mods-edit');
  const el = document.createElement('div');
  el.className = 'mod-picker-pop';
  const onKey = (e) => { if (e.key === 'Escape') closeModPicker(); };
  // Any pointer press outside the popover dismisses it. Listening for
  // pointerdown (not click) is safe against self-close: this popover is opened
  // from a click handler, so the opening interaction's pointerdown already
  // fired before this listener was attached — only a fresh press reaches it.
  const onDocDown = (e) => { if (!el.contains(e.target)) closeModPicker(); };
  current = { el, onKey, onDocDown, cell };
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onDocDown, true);

  const filterRows = (value) => {
    const q = value.trim().toLowerCase();
    el.querySelectorAll('.mod-picker__col .mod-picker__row').forEach((row) => {
      row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  };
  const rerender = () => {
    const searchInput = el.querySelector('.mod-picker__search');
    const searchValue = searchInput?.value ?? '';
    const searchFocused = document.activeElement === searchInput;
    const selectionStart = searchInput?.selectionStart;
    const selectionEnd = searchInput?.selectionEnd;
    el.innerHTML = modPickerHtml(view, current.cell);
    const nextSearchInput = el.querySelector('.mod-picker__search');
    if (nextSearchInput) {
      nextSearchInput.value = searchValue;
      filterRows(searchValue);
      if (searchFocused) {
        nextSearchInput.focus();
        if (selectionStart !== null && selectionStart !== undefined &&
            selectionEnd !== null && selectionEnd !== undefined) {
          nextSearchInput.setSelectionRange(selectionStart, selectionEnd);
        }
      }
    }
    position();
  };
  const emit = (next) => { current.cell = next; onChange(next); rerender(); };

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-mod-close]')) { closeModPicker(); return; }
    // Corrupted implicit (single choice) — base and unique alike.
    const corr = e.target.closest('[data-mod-corrupt]')?.getAttribute('data-mod-corrupt');
    if (corr) { emit({ ...current.cell, corrupted: { affix: corr, tier: defaultTier(view, corr) } }); return; }
    if (e.target.closest('[data-mod-corrupt-remove]')) { emit({ ...current.cell, corrupted: null }); return; }
    // Prefix/suffix explicit mods (bases).
    const add = e.target.closest('[data-mod-add]')?.getAttribute('data-mod-add');
    if (add) {
      const c = current.cell;
      if ((c.mods ?? []).some((m) => m.affix === add)) return;   // one row per family
      emit({ ...c, mods: [...(c.mods ?? []), { affix: add, tier: defaultTier(view, add) }] });
      return;
    }
    const rm = e.target.closest('[data-mod-remove]')?.getAttribute('data-mod-remove');
    if (rm) emit({ ...current.cell, mods: (current.cell.mods ?? []).filter((m) => m.affix !== rm) });
  });
  el.addEventListener('change', (e) => {
    const corrAffix = e.target.closest('[data-mod-tier-corrupt]')?.getAttribute('data-mod-tier-corrupt');
    if (corrAffix) { emit({ ...current.cell, corrupted: { affix: corrAffix, tier: e.target.value } }); return; }
    const affix = e.target.closest('[data-mod-tier]')?.getAttribute('data-mod-tier');
    if (!affix) return;
    emit({ ...current.cell, mods: (current.cell.mods ?? []).map((m) => (m.affix === affix ? { ...m, tier: e.target.value } : m)) });
  });
  el.addEventListener('input', (e) => {
    if (!e.target.matches('.mod-picker__search')) return;
    filterRows(e.target.value);
  });

  function position() {
    const live = slotId === null
      ? anchorEl
      : document.querySelector(`[data-mods-edit="${slotId}"]`) || anchorEl;
    const r = live.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const h = el.offsetHeight;
    const w = el.offsetWidth || 340;
    const M = 8; // viewport margin
    // Prefer just below the anchor; if the popover would run past the viewport
    // bottom, slide it up so the whole thing stays on screen without scrolling.
    let top = r.bottom + 6;
    if (top + h > vh - M) top = Math.max(M, vh - M - h);
    const left = Math.max(M, Math.min(r.left, vw - w - M));
    el.style.top = `${window.scrollY + top}px`;
    el.style.left = `${window.scrollX + left}px`;
  }
  document.body.append(el);
  rerender();
  el.querySelector('.mod-picker__search')?.focus();
}
