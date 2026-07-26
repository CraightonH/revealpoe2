// Browser controller for the /builds editor view. Pure rendering lives in
// editor-render.js; this file owns event wiring and store mutations.
import { grantedRows, renderEditor } from '/static/js/editor-render.js';
import { openPicker, closePicker } from '/static/js/entity-picker.js';
import { openModPicker, closeModPicker } from '/static/js/mod-picker.js';
import { legalSlots, equipViolations } from '/static/js/build-rules.js';
import { safeWrite, loadBuildExport } from '/static/js/build-host.js';
import { LIMITS } from '/static/js/build-store.js';
import { encodeGroup } from '/static/js/build-code.js';
import { buildToBuildFile, buildFileName } from '/static/js/build-file.js';
import { load as loadTree } from '/static/js/passive-tree.js';
import { reconcilePriority, renderPriorityList } from '/static/js/tree-priority.js';
import { mountTreePreview, destroyTreePreview } from '/static/js/tree-preview.js';

const KIND_FOR_CATEGORY = { gem: 'gem', support: 'gem', spirit: 'gem', unique: 'unique', base: 'base' };

/**
 * The GGG class name + ascendancy id for a build, which is what the tree embed
 * speaks. Our slugs are not interchangeable with them.
 */
function treeIdentity(build, planner) {
  const cls = (planner?.classes ?? []).find((c) => c.slug === build.class) ?? null;
  const asc = cls?.ascendancies.find((a) => a.slug === build.ascendancy) ?? null;
  return { className: cls?.name ?? null, ascId: asc?.gggId ?? null };
}

export function mountEditor(container, buildId, { store, planner, docs, resolveRef, pools, itemMath }) {
  let weaponSet = 1;
  let switcherOpen = false;
  let classPicker = null;   // null | 'class' | 'asc'
  let renaming = false;
  let variantRenaming = null;   // buildId of the variant label being edited
  let mode = 'edit';        // 'edit' | 'view' (read-only shared preview)
  // Rail Summary collapse is a view preference (not build data) — persisted per browser.
  const SUMMARY_KEY = 'reveal.planner.summaryCollapsed';
  let summaryCollapsed = (() => { try { return window.localStorage.getItem(SUMMARY_KEY) === '1'; } catch { return false; } })();

  // ---- embedded passive tree (Phase 5) --------------------------------
  let treeEmbed = null;       // the embed API (passive-tree.js init return)
  let treeLines = [];
  let treeWrapEl = null;      // the live .passive-tree-wrap DOM, reparented across renders
  let notableMeta = new Map();// h -> {kind,name,icon}, sourced live from the embed
  let suppressRender = false; // true while persisting a tree-only change (skip our own re-render)
  let dragH = null;

  const build = () => store.get(buildId);
  const patch = (p) => safeWrite(() => store.update(buildId, p));
  // Class/ascendancy belong to the GROUP, not to whichever variant is open.
  const setGroupClass = (cls, asc) => safeWrite(() => store.setGroupClass(buildId, cls, asc));
  const render = () => {
    const b = build();
    if (!b) { location.hash = ''; return; }
    // Detach the live embed before innerHTML wipes the old mount, so its canvas +
    // allocation state survive a full dossier re-render (gear/skill edits, etc.).
    if (treeWrapEl && treeWrapEl.parentNode) treeWrapEl.remove();
    // A read-only preview belongs to the rendering that created it.
    const oldPreview = container.querySelector('[data-tree-preview-mount]');
    if (oldPreview) destroyTreePreview(oldPreview);
    container.innerHTML = renderEditor(b, {
      planner, resolveRef, pools, weaponSet, mode, itemMath, treeLines, summaryCollapsed,
      builds: store.list(), currentId: buildId, switcherOpen, classPicker, renaming,
      group: store.group(buildId), variantRenaming,
    });
    if (mode === 'edit') mountTree(b);
    // Read-only modes get the preview embed automatically (dynamic import, so it
    // does not hold up this render).
    else mountTreePreview(container.querySelector('[data-tree-preview-mount]'), b.tree?.code ?? null,
      treeIdentity(b, planner));
  };

  // ---- passive-tree embed: mount / reparent / persist / refresh -------
  function mountTree(b) {
    const mountEl = container.querySelector('[data-tree-mount]');
    if (!mountEl) return;
    if (treeWrapEl) { mountEl.appendChild(treeWrapEl); refreshTreeUI(); return; } // reattach live embed
    treeWrapEl = document.createElement('div');
    treeWrapEl.className = 'passive-tree-wrap passive-tree-wrap--embed';
    const canvas = document.createElement('canvas');
    treeWrapEl.appendChild(canvas);
    mountEl.appendChild(treeWrapEl);
    loadTree(canvas, {
      root: treeWrapEl,
      initialCode: b.tree.code || null,
      // The editor copies the raw tree code — it must NEVER touch location.hash
      // (that is the /builds router).
      onCopy: (code) => navigator.clipboard.writeText(code),
      onReady: (api) => {
        treeEmbed = api;
        syncTreeClass();
        captureNotables();
        treeLines = treeEmbed.getAllocatedStatLines?.() ?? [];
        render();
      },
      onChange: () => {
        captureNotables();
        treeLines = treeEmbed?.getAllocatedStatLines?.() ?? [];
        render();
      },
      onCodeChange: (code) => persistTree(code),
    }).then((api) => { treeEmbed = api; }).catch((err) => console.warn('[builds] tree embed failed:', err));
  }
  function captureNotables() {
    if (!treeEmbed) return;
    notableMeta = new Map(treeEmbed.getAllocatedNotables().map((n) => [n.h, { kind: n.kind, name: n.name, icon: n.icon }]));
  }
  function currentOrder(b) {
    return reconcilePriority(b.tree.notablePriority || [], [...notableMeta.keys()]);
  }
  function persistTree(code) {
    const b = build(); if (!b) return;
    captureNotables();
    const notablePriority = currentOrder(b);
    suppressRender = true;
    patch({ tree: { code: code || null, notablePriority } });
    suppressRender = false;
  }
  const pts = (label, o) => `<span class="tree-chip"><b>${o.spent}</b>${o.max != null ? ` / ${o.max}` : ''} <span>${label}</span></span>`;
  function refreshTreeUI() {
    const b = build(); if (!b) return;
    const summary = container.querySelector('[data-tree-points-summary]');
    if (summary && treeEmbed) {
      const p = treeEmbed.getPoints();
      summary.innerHTML = pts('Passives', p.main) + (p.asc.spent ? pts('Ascendancy', p.asc) : '')
        + (p.ws1.spent ? pts('Set I', p.ws1) : '') + (p.ws2.spent ? pts('Set II', p.ws2) : '');
    }
    const box = container.querySelector('[data-notable-priority]');
    if (box) {
      const order = currentOrder(b);
      box.innerHTML = '<h3 class="editor-subhead">Notable Priority</h3>'
        + renderPriorityList(order, notableMeta, { readonly: false });
      for (const c of box.querySelectorAll('[data-prio-icon]')) {
        treeEmbed?.paintNodeIcon(Number(c.getAttribute('data-prio-icon')), c);
      }
    }
  }
  // Keep the embed's class/ascendancy matched to the build's own picker (the
  // authoritative selection). `force` = the user just changed the picker, so
  // drive the embed even if that resets the tree (changing class is a reset,
  // in-game). Without force (on mount) we never wipe an existing tree over a
  // metadata disagreement — we adopt the tree's class into the build instead.
  function syncTreeClass({ force = false } = {}) {
    if (!treeEmbed) return;
    const b = build(); if (!b) return;
    const meta = treeEmbed.data?.meta; if (!meta) return;
    const classes = planner.classes || [];
    const buildCls = b.class ? classes.find((c) => c.slug === b.class) : null;
    const cur = treeEmbed.getClassAscendancy();
    if (!buildCls) {
      // No class picked: on load, reflect an imported tree's class so the picker
      // matches; on an explicit "No class" pick, leave the tree untouched.
      if (!force && b.tree.code) adoptEmbedClassIntoBuild(meta, classes);
      return;
    }
    const targetClassName = buildCls.name;
    const ascName = b.ascendancy ? buildCls.ascendancies.find((a) => a.slug === b.ascendancy)?.name : null;
    const targetAscId = ascName ? (meta.ascByClass?.[targetClassName] || []).find((a) => a.name === ascName)?.id ?? null : null;
    if (!force && b.tree.code && (cur.className !== targetClassName || (!b.ascendancy && cur.ascId))) {
      adoptEmbedClassIntoBuild(meta, classes);
      return;
    }
    treeEmbed.setClassAscendancy(targetClassName, targetAscId);
  }
  function adoptEmbedClassIntoBuild(meta, classes) {
    const cur = treeEmbed.getClassAscendancy();
    const cls = classes.find((c) => c.name === cur.className);
    if (!cls) return;
    const ascName = cur.ascId ? (meta.ascByClass?.[cur.className] || []).find((a) => a.id === cur.ascId)?.name : null;
    const ascSlug = ascName ? (cls.ascendancies.find((a) => a.name === ascName)?.slug ?? null) : null;
    const b = build();
    if (b.class === cls.slug && b.ascendancy === ascSlug) return; // already matches
    // Group-wide, like the picker: an imported tree's class defines the whole
    // group, not just the variant that happened to be open when it loaded.
    setGroupClass(cls.slug, ascSlug);                             // re-renders → picker updates
  }

  function equip(slotId, ref) {
    const b = build();
    const gear = { ...b.gear };
    const prev = gear[slotId]?.item;
    gear[slotId] = { item: ref, mods: gear[slotId]?.mods ?? [], corrupted: gear[slotId]?.corrupted ?? null };
    const unassigned = b.unassigned.filter((r) => !(r.kind === ref.kind && r.slug === ref.slug));
    if (prev) unassigned.push(prev);

    // A two-hander landing in a mainhand slot displaces an off-hand it can't
    // share a weapon set with (in-game behavior). Companion off-hands (e.g.
    // bow+quiver) produce no violation and stay equipped.
    const mainMatch = /^weapon(\d+)a$/.exec(slotId);
    if (mainMatch && planner.items[ref.slug]?.twoHanded) {
      const offId = `weapon${mainMatch[1]}b`;
      const offItem = gear[offId]?.item;
      if (offItem) {
        const v = equipViolations({ ...b, gear }, planner, offId, offItem);
        if (v.some((x) => x.code === 'two-hander-blocks-offhand')) {
          gear[offId] = { ...gear[offId], item: null };
          unassigned.push(offItem);
        }
      }
    }
    patch({ gear, unassigned });
  }

  // ---- picker launches -----------------------------------------------
  function pickForSlot(slotId) {
    const legal = new Set(Object.entries(planner.items)
      .filter(([, rec]) => rec.slots.includes(slotId)).map(([slug]) => slug));
    // two-hander-blocks-offhand can only ever fire for an off-hand slot, so
    // only run the (relatively expensive) per-candidate simulation there.
    const isOffhandSlot = /^weapon\d+b$/.test(slotId);
    const b = build();
    openPicker({
      title: `Choose an item — ${planner.slots.find((s) => s.id === slotId)?.name ?? slotId}`,
      docs: docs.filter((d) => legal.has(d.slug)).filter((d) => {
        if (!isOffhandSlot) return true;
        const ref = { kind: KIND_FOR_CATEGORY[d.category], slug: d.slug };
        return !equipViolations(b, planner, slotId, ref)
          .some((x) => x.code === 'two-hander-blocks-offhand');
      }),
      categories: ['unique', 'base'],
      onPick: (doc) => equip(slotId, { kind: KIND_FOR_CATEGORY[doc.category], slug: doc.slug }),
    });
  }

  function pickGem(onPick) {
    openPicker({ title: 'Choose a skill', docs, categories: ['gem', 'spirit'], onPick });
  }

  function pickSupport(forGemSlug, onPick) {
    openPicker({
      title: 'Choose a support', docs, categories: ['support'],
      rank: planner.recommends?.[forGemSlug] ?? [],
      onPick,
    });
  }

  // ---- socket helpers --------------------------------------------------
  function parseSocket(attr) {  // "s:<i>:<j>" or "g:<itemSlug>:<skillSlug>:<j>"
    const parts = attr.split(':');
    if (parts[0] === 's') return { kind: 's', setup: Number(parts[1]), j: Number(parts[2]) };
    return { kind: 'g', key: parts.slice(1, -1).join(':'), j: Number(parts.at(-1)) };
  }

  function setSocket(sock, supRef) {   // supRef {slug} or null to clear
    const b = build();
    if (sock.kind === 's') {
      const skills = b.skills.map((s, i) => {
        if (i !== sock.setup) return s;
        const supports = [...s.supports];
        if (supRef) supports[sock.j] = supRef; else supports.splice(sock.j, 1);
        return { ...s, supports: supports.filter(Boolean) };
      });
      patch({ skills });
    } else {
      const all = { ...(b.grantedSupports ?? {}) };
      const list = [...(all[sock.key] ?? [])];
      if (supRef) list[sock.j] = supRef; else list.splice(sock.j, 1);
      all[sock.key] = list.filter(Boolean);
      patch({ grantedSupports: all });
    }
  }

  function gemForSocket(sock) {
    const b = build();
    return sock.kind === 's' ? b.skills[sock.setup]?.gem.slug : sock.key.split(':').at(-1);
  }

  // ---- delegated events ------------------------------------------------
  function onClick(e) {
    const attr = (n) => e.target.closest(`[${n}]`)?.getAttribute(n);

    if (e.target.closest('[data-summary-toggle]')) {
      e.preventDefault();
      summaryCollapsed = !summaryCollapsed;
      try { window.localStorage.setItem(SUMMARY_KEY, summaryCollapsed ? '1' : '0'); } catch { /* storage may be unavailable */ }
      // Toggle in place — no full re-render (which would reparent the tree embed).
      const panel = container.querySelector('[data-summary]');
      panel?.classList.toggle('collapsed', summaryCollapsed);
      panel?.querySelector('[data-summary-toggle]')?.setAttribute('aria-expanded', String(!summaryCollapsed));
      return;
    }
    if (e.target.closest('[data-view-published]')) {
      mode = 'view';
      switcherOpen = false; classPicker = null; renaming = false;
      render();
      return;
    }
    if (e.target.closest('[data-edit-build]')) {
      mode = 'edit';
      render();
      return;
    }
    if (e.target.closest('[data-switcher-toggle]')) {
      switcherOpen = !switcherOpen;
      classPicker = null;
      render();
      return;
    }
    const classToggle = attr('data-class-toggle');
    if (classToggle) {
      classPicker = classPicker === classToggle ? null : classToggle;
      switcherOpen = false;
      render();
      return;
    }
    const setClass = attr('data-set-class');
    if (setClass !== null && setClass !== undefined) {
      classPicker = null;
      const cls = planner.classes?.find((c) => c.slug === setClass) ?? null;
      const b = build();
      // Changing class drops an ascendancy that no longer belongs.
      const keepAsc = cls?.ascendancies.some((a) => a.slug === b.ascendancy);
      // Group-wide: variants are phases of ONE character.
      setGroupClass(setClass || null, keepAsc ? b.ascendancy : null);
      syncTreeClass({ force: true });   // drive the embed to the picked class
      return;
    }
    const setAsc = attr('data-set-asc');
    if (setAsc !== null && setAsc !== undefined) {
      classPicker = null;
      setGroupClass(build().class, setAsc || null);
      syncTreeClass({ force: true });   // drive the embed to the picked ascendancy
      return;
    }
    if (e.target.closest('[data-build-rename]')) {
      renaming = true;
      render();
      const inp = container.querySelector('[data-build-name-input]');
      inp?.focus();
      inp?.select();
      return;
    }
    // Any click outside an open popover closes it (row links navigate via
    // hashchange before this re-render matters).
    if ((switcherOpen || classPicker)
        && !e.target.closest('[data-switcher]') && !e.target.closest('[data-class-picker]')) {
      switcherOpen = false;
      classPicker = null;
      render();
      return;
    }

    if (e.target.closest('[data-variant-add]')) {
      const g = store.group(buildId);
      const parentId = g?.parent?.id ?? buildId;
      const child = safeWrite(() => store.addVariant(parentId, store.nextVariantLabel(buildId)));
      if (child) location.hash = `#/b/${encodeURIComponent(child.id)}`;
      return;
    }
    const vtab = attr('data-variant-tab');
    if (vtab) {
      if (vtab !== buildId) location.hash = `#/b/${encodeURIComponent(vtab)}`;
      return;
    }
    const vrename = attr('data-variant-rename');
    if (vrename) {
      variantRenaming = vrename;
      render();
      const inp = container.querySelector('[data-variant-label-input]');
      inp?.focus();
      inp?.select();
      return;
    }
    const vdelete = attr('data-variant-delete');
    if (vdelete) {
      // X on a variant tab DELETES that variant, which is what the affordance
      // reads as. It used to only *detach* it, and because the editor stayed on
      // the now-orphaned build — whose own group is itself with no variants —
      // the entire group appeared to vanish. Nothing had been deleted; it just
      // wasn't reachable from where you were standing. Navigate to the parent so
      // the rest of the group stays in view either way.
      const g = store.group(buildId);
      const parentId = g?.parent?.id;
      const label = g?.variants.find((v) => v.buildId === vdelete)?.label ?? 'this variant';
      if (!parentId || parentId === vdelete) return;   // never fires on the parent tab
      if (!window.confirm(`Delete the variant “${label}”? This cannot be undone. `
        + 'The rest of the group is kept.')) return;
      safeWrite(() => store.remove(vdelete));          // remove() prunes the parent's entry
      location.hash = `#/b/${encodeURIComponent(parentId)}`;
      return;
    }

    if (e.target.closest('[data-share]')) {
      const btn = e.target.closest('[data-share]');
      btn.disabled = true;
      encodeGroup(store.group(buildId) ?? { parent: build(), variants: [] })
        .then((code) => {
          const url = `${location.origin}/builds#/import/${code}`;
          const n = (store.group(buildId)?.variants ?? []).length;
          return navigator.clipboard.writeText(url).then(
            () => { btn.textContent = n ? `Link copied ✓ (${n + 1} builds)` : 'Link copied ✓'; },
            () => { window.prompt('Copy this share link:', url); });
        })
        .finally(() => {
          btn.disabled = false;
          setTimeout(() => {
            const b2 = container.querySelector('[data-share]');
            if (b2) b2.textContent = 'Share';
          }, 1800);
        });
      return;
    }

    if (e.target.closest('[data-export-build]')) {
      const btn = e.target.closest('[data-export-build]');
      const note = container.querySelector('[data-export-note]');
      btn.disabled = true;
      btn.textContent = 'Preparing…';
      loadBuildExport()
        .then((ids) => {
          const b = build();
          const file = buildToBuildFile(b, {
            ids, pools, resolveRef,
            grantedRows: (bb) => grantedRows(bb, planner),
          });
          const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = buildFileName(b.name);
          document.body.appendChild(a);
          a.click();
          a.remove();
          // Revoke on the next turn so the download has started.
          setTimeout(() => URL.revokeObjectURL(url), 0);
          if (note) {
            note.hidden = false;
            note.textContent = 'Saved. Put the file in Documents\\My Games\\Path of Exile 2\\BuildPlanner\\ '
              + 'to open it in the in-game Build Planner (PC only — consoles cannot import files).';
          }
        })
        .catch(() => {
          if (note) { note.hidden = false; note.textContent = 'Export data could not be loaded — try again.'; }
        })
        .finally(() => {
          btn.disabled = false;
          btn.textContent = 'Export .build';
        });
      return;
    }

    const clear = attr('data-slot-clear');
    if (clear) {
      e.stopPropagation();
      const b = build();
      const item = b.gear[clear]?.item;
      if (item) patch({ gear: { ...b.gear, [clear]: { ...b.gear[clear], item: null } },
                        unassigned: [...b.unassigned, item] });
      return;
    }
    const modsEdit = e.target.closest('[data-mods-edit]');
    if (modsEdit) {
      e.stopPropagation();
      const slotId = modsEdit.getAttribute('data-mods-edit');
      const b = build();
      const cell = b.gear[slotId];
      if (!cell?.item || !pools) return;
      openModPicker({
        anchorEl: modsEdit, ref: cell.item, cell, pools,
        onChange: (next) => patch({ gear: { ...build().gear, [slotId]: next } }),
      });
      return;
    }
    const slot = e.target.closest('[data-slot-id]');
    if (slot) { pickForSlot(slot.getAttribute('data-slot-id')); return; }

    const ws = attr('data-weapon-set');
    if (ws) { weaponSet = Number(ws); render(); return; }

    const equipIdx = attr('data-tray-equip');
    if (equipIdx !== null && equipIdx !== undefined) {
      const b = build();
      const ref = b.unassigned[Number(equipIdx)];
      if (!ref) return;
      if (ref.kind === 'gem') {   // gems become skill setups, not gear
        if (b.skills.length >= LIMITS.setups) {
          window.alert(`This build already has the maximum of ${LIMITS.setups} skill setups.`);
          return;
        }
        patch({ skills: [...b.skills, { gem: { slug: ref.slug }, level: null, supports: [] }],
                unassigned: b.unassigned.filter((_, i) => i !== Number(equipIdx)) });
        return;
      }
      const slots = legalSlots(ref, planner)
        .filter((s) => !equipViolations(build(), planner, s, ref)
          .some((x) => x.code === 'two-hander-blocks-offhand'));
      if (!slots.length) return;
      const target = slots.find((s) => !build().gear[s]?.item) ?? slots[0];
      equip(target, ref);   // equip() re-adds any displaced item to the tray
      return;
    }
    const removeIdx = attr('data-tray-remove');
    if (removeIdx !== null && removeIdx !== undefined) {
      const b = build();
      patch({ unassigned: b.unassigned.filter((_, i) => i !== Number(removeIdx)) });
      return;
    }

    if (e.target.closest('[data-setup-add]')) {
      if (build().skills.length >= LIMITS.setups) return;   // button is disabled; keyboard/dup-click guard
      pickGem((doc) => {
        const cur = build().skills;
        if (cur.length >= LIMITS.setups) return;
        patch({ skills: [...cur, { gem: { slug: doc.slug }, level: null, supports: [] }] });
      });
      return;
    }
    const gw = attr('data-gem-well');
    if (gw !== null && gw !== undefined) {
      pickGem((doc) => patch({ skills: build().skills.map((s, i) =>
        i === Number(gw) ? { ...s, gem: { slug: doc.slug } } : s) }));
      return;
    }
    const rm = attr('data-setup-remove');
    if (rm !== null && rm !== undefined) {
      patch({ skills: build().skills.filter((_, i) => i !== Number(rm)) });
      return;
    }
    const mv = attr('data-setup-move');
    if (mv) {
      const [iStr, dir] = mv.split(':');
      const i = Number(iStr), to = dir === 'up' ? i - 1 : i + 1;
      const skills = [...build().skills];
      if (to < 0 || to >= skills.length) return;
      [skills[i], skills[to]] = [skills[to], skills[i]];
      patch({ skills });
      return;
    }
    const prioRemove = attr('data-prio-remove');
    if (prioRemove !== null && prioRemove !== undefined) {
      const h = Number(prioRemove);
      treeEmbed?.setHighlight(null);
      treeEmbed?.deallocate(h);
      return;
    }
    const prioRow = e.target.closest('[data-prio-row]');
    if (prioRow && !e.target.closest('[data-prio-remove]')) {
      treeEmbed?.focusNode(Number(prioRow.getAttribute('data-prio-row')));
      treeWrapEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const sc = attr('data-socket-clear');
    if (sc) { e.stopPropagation(); setSocket(parseSocket(sc), null); return; }
    const so = attr('data-socket');
    if (so) {
      const sock = parseSocket(so);
      pickSupport(gemForSocket(sock), (doc) => setSocket(sock, { slug: doc.slug }));
    }
  }

  function onChange(e) {
    if (e.target.closest('[data-description]')) { patch({ description: e.target.value }); return; }
    if (e.target.closest('[data-notes]')) patch({ notes: e.target.value });
  }

  function onPointerOver(e) {
    if (mode !== 'edit') return;
    const row = e.target.closest?.('[data-prio-row]');
    if (row && treeEmbed) treeEmbed.setHighlight([Number(row.getAttribute('data-prio-row'))]);
  }

  function onPointerOut(e) {
    if (mode !== 'edit') return;
    const row = e.target.closest?.('[data-prio-row]');
    if (row && !row.contains(e.relatedTarget) && treeEmbed) treeEmbed.setHighlight(null);
  }

  function onDragStart(e) {
    if (mode !== 'edit') return;
    const row = e.target.closest?.('[data-prio-row]');
    if (!row) return;
    dragH = Number(row.getAttribute('data-prio-row'));
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e) {
    if (mode === 'edit' && dragH != null && e.target.closest?.('[data-prio-dnd]')) e.preventDefault();
  }

  function onDrop(e) {
    if (mode !== 'edit') return;
    const target = e.target.closest?.('[data-prio-row]');
    if (dragH == null || !target) return;
    e.preventDefault();
    const b = build();
    const order = currentOrder(b);
    const from = order.indexOf(dragH);
    const to = order.indexOf(Number(target.getAttribute('data-prio-row')));
    if (from < 0 || to < 0 || from === to) {
      dragH = null;
      return;
    }
    order.splice(to, 0, order.splice(from, 1)[0]);
    dragH = null;
    suppressRender = true;
    patch({ tree: { ...b.tree, notablePriority: order } });
    suppressRender = false;
    refreshTreeUI();
  }

  // Inline rename: blur or Enter commits (non-empty, changed), Escape cancels.
  function commitRename(input) {
    if (!renaming) return;
    renaming = false;
    const v = input.value.trim();
    if (v && v !== build().name) patch({ name: v });
    else render();
  }
  function commitVariantLabel(input) {
    if (!variantRenaming) return;
    const id = variantRenaming;
    variantRenaming = null;
    const v = input.value.trim();
    const g = store.group(buildId);
    // setLabel handles the root and a variant alike (their labels live in
    // different places); the root's current label defaults to "Variant 1".
    const cur = id === g?.parent?.id
      ? (g.parent.label || 'Variant 1')
      : g?.variants.find((x) => x.buildId === id)?.label;
    if (v && v !== cur) safeWrite(() => store.setLabel(id, v));
    else render();
  }
  function onFocusOut(e) {
    if (e.target.closest?.('[data-build-name-input]')) { commitRename(e.target); return; }
    if (e.target.closest?.('[data-variant-label-input]')) commitVariantLabel(e.target);
  }
  function onKeyDown(e) {
    if (e.target.closest?.('[data-variant-label-input]')) {
      if (e.key === 'Enter') { e.preventDefault(); commitVariantLabel(e.target); }
      if (e.key === 'Escape') { variantRenaming = null; render(); }
      return;
    }
    if (!e.target.closest?.('[data-build-name-input]')) return;
    if (e.key === 'Enter') { e.preventDefault(); commitRename(e.target); }
    if (e.key === 'Escape') { renaming = false; render(); }
  }


  container.addEventListener('click', onClick);
  container.addEventListener('change', onChange);
  container.addEventListener('focusout', onFocusOut);
  container.addEventListener('keydown', onKeyDown);
  container.addEventListener('pointerover', onPointerOver);
  container.addEventListener('pointerout', onPointerOut);
  container.addEventListener('dragstart', onDragStart);
  container.addEventListener('dragover', onDragOver);
  container.addEventListener('drop', onDrop);
  render();
  const unsub = store.subscribe(() => { if (suppressRender) return; render(); });

  return function unmount() {
    container.removeEventListener('click', onClick);
    container.removeEventListener('change', onChange);
    container.removeEventListener('focusout', onFocusOut);
    container.removeEventListener('keydown', onKeyDown);
    container.removeEventListener('pointerover', onPointerOver);
    container.removeEventListener('pointerout', onPointerOut);
    container.removeEventListener('dragstart', onDragStart);
    container.removeEventListener('dragover', onDragOver);
    container.removeEventListener('drop', onDrop);
    treeEmbed?.destroy?.();
    treeEmbed = null;
    treeWrapEl = null;
    unsub();
    closePicker();
    closeModPicker();
  };
}
