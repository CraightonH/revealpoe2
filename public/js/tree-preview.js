// public/js/tree-preview.js
// Mounts a READ-ONLY passive tree into a build preview — the "View" mode inside
// the editor and the shared-link (#/import/<code>) page.
//
// Mounted automatically: the tree is pivotal to a build, so making people ask
// for it was pure friction (2026-07-26). The embed is ~3 MB, so the import stays
// DYNAMIC — the page paints its summary, gear and skills first and the tree
// fills in after, rather than blocking first paint on it.
//
// After mount the view is framed to the ALLOCATION rather than the whole disc:
// a build uses one region of the tree, and nobody reading a preview wants to
// hunt for it.
//
// The class MUST be driven in explicitly. A v7 code carries a charClass byte but
// passive-tree.js never reads it, so an imported code alone leaves the embed on
// whatever class it defaulted to — which is why a Warrior build's tree showed the
// wrong centrepiece while every other surface was correct. Order matters:
// selecting a class RESETS allocations (in-game behaviour) and importing a code
// clears the ascendancy, so it goes class -> code -> ascendancy.

const mounted = new WeakMap();   // mount element -> embed api

/**
 * Mount the tree read-only into `mountEl`, showing `code`'s allocation.
 * Idempotent per element: a second call re-focuses the existing embed rather
 * than building another canvas.
 * @param {HTMLElement} mountEl
 * @param {string|null} code v7 passive share code
 * @param {{className?: string|null, ascId?: string|null,
 *          onReady?: (api: object) => void, onError?: (e: Error) => void}} [opts]
 *        className/ascId are the GGG names/ids ("Warrior", "Warrior2"), not our slugs.
 */
export async function mountTreePreview(mountEl, code, opts = {}) {
  if (!mountEl) return null;
  if (mounted.has(mountEl)) return mounted.get(mountEl);

  mountEl.textContent = 'Loading the passive tree…';
  mountEl.classList.add('is-loading');
  try {
    const { load } = await import('/static/js/passive-tree.js');
    mountEl.textContent = '';
    const wrap = document.createElement('div');
    wrap.className = 'passive-tree-wrap passive-tree-wrap--embed passive-tree-wrap--readonly';
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    mountEl.appendChild(wrap);

    // NOTE: no initialCode here. The class has to be established first (see the
    // header note), and selecting a class wipes the allocation — so loading the
    // code up front would just get it thrown away.
    const api = await load(canvas, {
      root: wrap,
      readonly: true,
      // A preview must never write anywhere: no onCodeChange, and copying the
      // code is the host's business, not ours.
      onCopy: (c) => navigator.clipboard?.writeText(c),
    });
    // Class BEFORE the code (selecting a class resets allocations), ascendancy
    // AFTER it (importing the code clears the ascendancy selection, and
    // selectAscendancy only drops nodes belonging to a *different* ascendancy,
    // so the main-tree allocation survives).
    if (opts.className) {
      try { api.setClassAscendancy(opts.className, null); } catch { /* keep the default */ }
    }
    if (code) {
      try { await api.setCode(code); } catch { /* an unreadable code leaves an empty tree */ }
    }
    if (opts.className && opts.ascId) {
      try { api.setClassAscendancy(opts.className, opts.ascId); } catch { /* class alone is still right */ }
    }
    try { api.fitAllocated?.(); } catch { /* fall back to the default fit */ }
    mounted.set(mountEl, api);
    mountEl.classList.remove('is-loading');
    opts.onReady?.(api);
    return api;
  } catch (e) {
    mountEl.classList.remove('is-loading');
    mountEl.textContent = 'The passive tree could not be loaded.';
    opts.onError?.(e);
    return null;
  }
}

/** Tear down an embed mounted here (route change / re-render). */
export function destroyTreePreview(mountEl) {
  const api = mountEl && mounted.get(mountEl);
  if (!api) return;
  api.destroy?.();
  mounted.delete(mountEl);
  mountEl.innerHTML = '';
}
