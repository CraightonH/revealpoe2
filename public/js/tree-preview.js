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
      // Let the embed own the timing: it reframes when the canvas gets real
      // dimensions AND when a code is applied, in whichever order those land.
      // Calling fitAllocated() from here instead raced both and produced the
      // right zoom only ~60% of the time.
      fitTo: 'allocated',
      // A preview must never write anywhere: no onCodeChange, and copying the
      // code is the host's business, not ours.
      onCopy: (c) => navigator.clipboard?.writeText(c),
    });
    // CODE FIRST, then assert the class.
    //
    // importCode infers the class by BFS from each class start and overwrites
    // whatever was selected — so setting the class first is pointless, and
    // correcting it afterwards used to wipe the allocation (selectClass resets
    // by design). keepAllocation lets the planner say "these passives are this
    // class's" — which it knows for certain, and the inference does not for a
    // sparse allocation.
    if (code) {
      try { await api.setCode(code); } catch { /* an unreadable code leaves an empty tree */ }
    }
    if (opts.className) {
      try {
        api.setClassAscendancy(opts.className, opts.ascId || null, { keepAllocation: true });
      } catch { /* the inferred class is still a reasonable fallback */ }
    }
    // No manual fit here — fitTo:'allocated' above handles it deterministically.
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
