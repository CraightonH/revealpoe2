// Browser controller for the /builds editor view. Pure rendering lives in
// editor-render.js; this file owns event wiring and store mutations.
import { renderEditor } from '/static/js/editor-render.js';
import { openPicker, closePicker } from '/static/js/entity-picker.js';
import { openModPicker, closeModPicker } from '/static/js/mod-picker.js';
import { legalSlots, equipViolations } from '/static/js/build-rules.js';
import { safeWrite } from '/static/js/build-host.js';
import { encodeBuild } from '/static/js/build-code.js';
import { decode as decodePassiveCode } from '/static/js/passive-code.js';

const KIND_FOR_CATEGORY = { gem: 'gem', support: 'gem', spirit: 'gem', unique: 'unique', base: 'base' };

export function mountEditor(container, buildId, { store, planner, docs, resolveRef, pools }) {
  let weaponSet = 1;
  let switcherOpen = false;
  let classPicker = null;   // null | 'class' | 'asc'
  let renaming = false;
  let mode = 'edit';        // 'edit' | 'view' (read-only shared preview)

  const build = () => store.get(buildId);
  const patch = (p) => safeWrite(() => store.update(buildId, p));
  const render = () => {
    const b = build();
    if (!b) { location.hash = ''; return; }
    container.innerHTML = renderEditor(b, {
      planner, resolveRef, pools, weaponSet, mode,
      builds: store.list(), currentId: buildId, switcherOpen, classPicker, renaming,
    });
  };

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
      patch({ class: setClass || null, ascendancy: keepAsc ? b.ascendancy : null });
      return;
    }
    const setAsc = attr('data-set-asc');
    if (setAsc !== null && setAsc !== undefined) {
      classPicker = null;
      patch({ ascendancy: setAsc || null });
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

    if (e.target.closest('[data-share]')) {
      const btn = e.target.closest('[data-share]');
      btn.disabled = true;
      encodeBuild(build())
        .then((code) => {
          const url = `${location.origin}/builds#/import/${code}`;
          return navigator.clipboard.writeText(url).then(
            () => { btn.textContent = 'Link copied ✓'; },
            () => { window.prompt('Copy this share link:', url); });
        })
        .finally(() => {
          btn.disabled = false;
          setTimeout(() => {
            const b2 = container.querySelector('[data-share]');
            if (b2) b2.textContent = 'Copy share link';
          }, 1800);
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
      pickGem((doc) => patch({ skills: [...build().skills, { gem: { slug: doc.slug }, level: null, supports: [] }] }));
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
    const tc = e.target.closest('[data-tree-code]');
    if (tc) {
      const v = tc.value.trim();
      if (!v) { patch({ tree: { ...build().tree, code: null } }); return; }
      // decode() is lenient with garbage bytes — the version word is the
      // reliable validity signal (official codes are v7).
      try { if (decodePassiveCode(v).version !== 7) throw new Error('bad version'); }
      catch { tc.classList.add('is-invalid'); return; }
      patch({ tree: { ...build().tree, code: v } });
      return;
    }
    if (e.target.closest('[data-notes]')) patch({ notes: e.target.value });
  }

  // Inline rename: blur or Enter commits (non-empty, changed), Escape cancels.
  function commitRename(input) {
    if (!renaming) return;
    renaming = false;
    const v = input.value.trim();
    if (v && v !== build().name) patch({ name: v });
    else render();
  }
  function onFocusOut(e) {
    if (e.target.closest?.('[data-build-name-input]')) commitRename(e.target);
  }
  function onKeyDown(e) {
    if (!e.target.closest?.('[data-build-name-input]')) return;
    if (e.key === 'Enter') { e.preventDefault(); commitRename(e.target); }
    if (e.key === 'Escape') { renaming = false; render(); }
  }


  container.addEventListener('click', onClick);
  container.addEventListener('change', onChange);
  container.addEventListener('focusout', onFocusOut);
  container.addEventListener('keydown', onKeyDown);
  render();
  const unsub = store.subscribe(() => render());

  return function unmount() {
    container.removeEventListener('click', onClick);
    container.removeEventListener('change', onChange);
    container.removeEventListener('focusout', onFocusOut);
    container.removeEventListener('keydown', onKeyDown);
    unsub();
    closePicker();
    closeModPicker();
  };
}
