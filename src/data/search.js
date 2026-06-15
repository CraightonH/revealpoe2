import { listGems } from './gems.js';
import { listUniques } from './uniques.js';
import { getItemClass, listItemClasses } from './baseItems.js';
import { listKeystones, listNotables } from './passiveTree.js';
import { listModGroups } from './mods.js';

let _docs = null;

function docs() {
  if (_docs) return _docs;
  const gems = listGems().map((g) => ({
    name: g.name, slug: g.slug, url: `/gem/${g.slug}`,
    haystack: g.name.toLowerCase(), category: 'Gem',
  }));
  const uniques = listUniques().map((u) => ({
    name: u.name, slug: u.slug, url: `/unique/${u.slug}`,
    haystack: u.name.toLowerCase(), category: 'Unique',
  }));
  const bases = listItemClasses().flatMap((group) =>
    group.classes.flatMap((cls) => {
      const c = getItemClass(cls.classSlug);
      return (c?.bases ?? []).map((b) => ({
        name: b.name, slug: b.slug, url: `/base/${b.slug}`,
        haystack: b.name.toLowerCase(), category: 'Base',
      }));
    })
  );
  const keystones = listKeystones().map((k) => ({
    name: k.name, slug: k.id, url: `/keystone/${k.id}`,
    haystack: (k.name + ' ' + k.statRaw).toLowerCase(), category: 'Keystone',
  }));
  const notables = listNotables().map((n) => ({
    name: n.name, slug: n.id, url: `/notable/${n.id}`,
    haystack: (n.name + ' ' + n.statRaw).toLowerCase(), category: 'Notable',
  }));
  const mods = listModGroups()
    .filter((g) => g.text)
    .map((g) => ({
      name: g.text, slug: g.typeSlug, url: `/mod/${g.typeSlug}`,
      haystack: g.text.toLowerCase(), category: 'Affix',
    }));
  // Order matters: higher-intent matches first so the 20-result cap favors
  // named entities (gems, uniques, keystones, mods) over notables.
  _docs = [...gems, ...uniques, ...keystones, ...mods, ...bases, ...notables];
  return _docs;
}

export function search(q, limit = 20) {
  const needle = (q ?? '').trim().toLowerCase();
  if (!needle) return [];
  const out = [];
  for (const d of docs()) {
    if (d.haystack.includes(needle)) {
      out.push({ name: d.name, slug: d.slug, url: d.url, category: d.category });
      if (out.length >= limit) break;
    }
  }
  return out;
}
