import { listGems } from './gems.js';

let _docs = null;

function docs() {
  if (_docs) return _docs;
  _docs = listGems().map((g) => ({
    name: g.name,
    slug: g.slug,
    color: g.color,
    url: `/gem/${g.slug}`,
    haystack: g.name.toLowerCase(),
  }));
  return _docs;
}

export function search(q, limit = 20) {
  const needle = (q ?? '').trim().toLowerCase();
  if (!needle) return [];
  const out = [];
  for (const d of docs()) {
    if (d.haystack.includes(needle)) {
      out.push({ name: d.name, slug: d.slug, color: d.color, url: d.url });
      if (out.length >= limit) break;
    }
  }
  return out;
}
