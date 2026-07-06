// public/js/build-rules.js
//
// Pure slot/socket legality rules for the Build Planner. No node:/DOM imports —
// importable by node:test (relative path) and by the browser at
// /static/js/build-rules.js. Operates on a parsed planner-data.json object and a
// build (schema v1). Returns violation lists; never throws on malformed input.
//
//   legalSlots(itemRef, plannerData)  -> string[]         which slots an item may occupy
//   gearViolations(build, plannerData)-> Violation[]      slot placement / occupancy
//   setupViolations(build, gemData)   -> Violation[]      skill-setup socket rules
//
// Violation = { code, slotId?, setup?, support?, message }

const WEAPON_SETS = [
  ['weapon1a', 'weapon1b'],
  ['weapon2a', 'weapon2b'],
];

export function legalSlots(itemRef, plannerData) {
  if (!itemRef || !plannerData) return [];
  return plannerData.items?.[itemRef.slug]?.slots ?? [];
}

export function gearViolations(build, plannerData) {
  const out = [];
  const gear = build?.gear ?? {};
  const items = plannerData?.items ?? {};
  const infoAt = (slotId) => {
    const slug = gear[slotId]?.item?.slug;
    return slug ? items[slug] ?? null : null;
  };

  // Item placed in a slot it does not fit.
  for (const [slotId, cell] of Object.entries(gear)) {
    const slug = cell?.item?.slug;
    if (!slug) continue;
    const info = items[slug];
    if (info && Array.isArray(info.slots) && !info.slots.includes(slotId)) {
      out.push({ code: 'illegal-slot', slotId, message: `${slug} cannot be placed in ${slotId}` });
    }
  }

  // Per weapon set: two-hander occupancy + off-hand main-hand requirements.
  for (const [mainId, offId] of WEAPON_SETS) {
    const main = infoAt(mainId);
    const offFilled = Boolean(gear[offId]?.item?.slug);
    const off = infoAt(offId);

    if (main?.twoHanded && offFilled) {
      out.push({
        code: 'two-hander-blocks-offhand',
        slotId: offId,
        message: `a two-handed weapon in ${mainId} leaves no room for an off-hand`,
      });
    }
    if (Array.isArray(off?.requiresMainhand)) {
      const mainClass = main?.class ?? null;
      if (!mainClass || !off.requiresMainhand.includes(mainClass)) {
        out.push({
          code: 'requires-mainhand',
          slotId: offId,
          message: `off-hand in ${offId} requires a ${off.requiresMainhand.join('/')} in ${mainId}`,
        });
      }
    }
  }

  return out;
}

export function setupViolations(build, gemData) {
  const out = [];
  const setups = build?.skills ?? [];
  const gems = gemData ?? {};
  const seen = new Map(); // support slug -> first setup index

  setups.forEach((setup, i) => {
    const supports = setup?.supports ?? [];
    const gemSlug = setup?.gem?.slug;
    const max = (gemSlug && gems[gemSlug]?.maxSupports != null) ? gems[gemSlug].maxSupports : 5;

    if (supports.length > max) {
      out.push({ code: 'socket-overflow', setup: i, message: `${supports.length} supports exceed ${max} sockets` });
    }
    for (const s of supports) {
      const slug = s?.slug;
      if (!slug) continue;
      if (seen.has(slug)) {
        out.push({ code: 'duplicate-support', setup: i, support: slug, message: `support ${slug} already used in setup ${seen.get(slug)}` });
      } else {
        seen.set(slug, i);
      }
    }
  });

  return out;
}
