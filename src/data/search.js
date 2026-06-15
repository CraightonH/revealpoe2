import { listGems } from './gems.js';
import { listUniques } from './uniques.js';
import { getItemClass, listItemClasses } from './baseItems.js';

let _docs = null;

function docs() {
  if (_docs) return _docs;
  const gems = listGems().map((g) => ({
    name: g.name,
    slug: g.slug,
    url: `/gem/${g.slug}`,
    haystack: g.name.toLowerCase(),
  }));
  const uniques = listUniques().map((u) => ({
    name: u.name,
    slug: u.slug,
    url: `/unique/${u.slug}`,
    haystack: u.name.toLowerCase(),
  }));
  const bases = listItemClasses().flatMap((group) =>
    group.classes.flatMap((cls) => {
      const c = getItemClass(cls.classSlug);
      return (c?.bases ?? []).map((b) => ({
        name: b.name,
        slug: b.slug,
        url: `/base/${b.slug}`,
        haystack: b.name.toLowerCase(),
      }));
    })
  );
  _docs = [...gems, ...uniques, ...bases];
  return _docs;
}

export function search(q, limit = 20) {
  const needle = (q ?? '').trim().toLowerCase();
  if (!needle) return [];
  const out = [];
  for (const d of docs()) {
    if (d.haystack.includes(needle)) {
      out.push({ name: d.name, slug: d.slug, url: d.url });
      if (out.length >= limit) break;
    }
  }
  return out;
}
