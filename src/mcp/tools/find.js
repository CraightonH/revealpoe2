// src/mcp/tools/find.js
import { err, DEFAULT_LIMIT, MAX_LIMIT } from './util.js';

export async function find(backend, { description, kind = null, limit = DEFAULT_LIMIT }) {
  const cap = Math.min(limit, MAX_LIMIT);
  const hits = await backend.search(description, { kind, limit: cap + 1 });
  return { results: hits.slice(0, cap), truncated: hits.length > cap };
}

export async function explain(backend, { term }) {
  let matches = await backend.nodesByName(term, ['keyword']);
  if (!matches.length) {
    const hits = await backend.search(term, { kind: 'keyword', limit: 3 });
    matches = await backend.nodesByIds(hits.map((h) => h.id));
  }
  if (!matches.length) return err('not_found', `no keyword matches '${term}'`);
  return {
    keywords: matches.map((n) => ({
      term: n.name, slug: n.slug,
      definition: n.props.definition ?? null,
      phrases: n.props.phrases ?? [],
    })),
  };
}
