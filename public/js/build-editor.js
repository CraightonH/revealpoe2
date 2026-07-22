// Browser controller for the /builds editor view. Pure rendering lives in
// editor-render.js; this file owns event wiring and store mutations.
import { renderEditor } from '/static/js/editor-render.js';
import { openPicker, closePicker } from '/static/js/entity-picker.js';
import { legalSlots, equipViolations } from '/static/js/build-rules.js';
import { safeWrite } from '/static/js/build-host.js';

const KIND_FOR_CATEGORY = { gem: 'gem', support: 'gem', spirit: 'gem', unique: 'unique', base: 'base' };

export function mountEditor(container, buildId, { store, planner, docs, resolveRef }) {
  let weaponSet = 1;

  const build = () => store.get(buildId);
  const patch = (p) => safeWrite(() => store.update(buildId, p));
  const render = () => {
    const b = build();
    if (!b) { location.hash = ''; return; }
    container.innerHTML = renderEditor(b, { planner, resolveRef, weaponSet });
  };

  function equip(slotId, ref) {
    const b = build();
    const gear = { ...b.gear };
    const prev = gear[slotId]?.item;
    gear[slotId] = { item: ref, wishlist: gear[slotId]?.wishlist ?? [] };
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
    openPicker({
      title: `Choose an item — ${planner.slots.find((s) => s.id === slotId)?.name ?? slotId}`,
      docs: docs.filter((d) => legal.has(d.slug)).filter((d) => {
        const ref = { kind: KIND_FOR_CATEGORY[d.category], slug: d.slug };
        return !equipViolations(build(), planner, slotId, ref)
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

    const clear = attr('data-slot-clear');
    if (clear) {
      e.stopPropagation();
      const b = build();
      const item = b.gear[clear]?.item;
      if (item) patch({ gear: { ...b.gear, [clear]: { ...b.gear[clear], item: null } },
                        unassigned: [...b.unassigned, item] });
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
    const lvl = e.target.closest('[data-setup-level]');
    if (lvl) {
      const i = Number(lvl.getAttribute('data-setup-level'));
      const v = lvl.value === '' ? null : Math.max(1, Math.min(40, Number(lvl.value) || 1));
      patch({ skills: build().skills.map((s, idx) => idx === i ? { ...s, level: v } : s) });
      return;
    }
    if (e.target.closest('[data-notes]')) patch({ notes: e.target.value });
  }

  container.addEventListener('click', onClick);
  container.addEventListener('change', onChange);
  render();
  const unsub = store.subscribe(() => render());

  return function unmount() {
    container.removeEventListener('click', onClick);
    container.removeEventListener('change', onChange);
    unsub();
    closePicker();
  };
}
