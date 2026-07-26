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

const mounted = new WeakMap();   // mount element -> embed api

/**
 * Mount the tree read-only into `mountEl`, showing `code`'s allocation.
 * Idempotent per element: a second call re-focuses the existing embed rather
 * than building another canvas.
 * @param {HTMLElement} mountEl
 * @param {string|null} code v7 passive share code
 * @param {{onReady?: (api: object) => void, onError?: (e: Error) => void}} [opts]
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

    const api = await load(canvas, {
      root: wrap,
      readonly: true,
      initialCode: code || null,
      // Frame the allocation once the code is in and the canvas has its real
      // size. onReady fires after the initial fit, so this supersedes it.
      onReady: (a) => { try { a.fitAllocated?.(); } catch { /* fall back to the default fit */ } },
      // A preview must never write anywhere: no onCodeChange, and copying the
      // code is the host's business, not ours.
      onCopy: (c) => navigator.clipboard?.writeText(c),
    });
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
