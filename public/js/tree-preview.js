// public/js/tree-preview.js
// Mounts a READ-ONLY passive tree into a build preview — the "View" mode inside
// the editor and the shared-link (#/import/<code>) page.
//
// Deliberately opt-in rather than eager. The embed pulls ~3 MB (the 230 KB gz
// tree artifact plus the sprite atlases it paints from) and takes several
// seconds; a shared link is something a stranger opens cold, and "view first"
// has to stay fast. So the preview shows the cheap summary until someone asks
// for the tree, then loads it once.
//
// Browser-only glue: passive-tree.js is imported dynamically so none of that
// payload is fetched — or even parsed — unless the button is pressed.

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
