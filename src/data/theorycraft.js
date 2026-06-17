const FIELDS = new Set(['type', 'color', 'tag', 'req', 'grants']);

// Tokenize a raw query into terms, honoring "quoted phrases", -exclusion,
// and field:value. Bare words, quoted phrases, and unknown field names all
// become free-text terms (the unknown field name is dropped). Never throws.
export function parseQuery(q) {
  const terms = [];
  const re = /(-?)(?:([a-zA-Z]+):)?(?:"([^"]*)"|(\S+))/g;
  let m;
  while ((m = re.exec(q ?? '')) !== null) {
    if (m[0].trim() === '') { re.lastIndex++; continue; }
    const negate = m[1] === '-';
    const rawField = m[2] ? m[2].toLowerCase() : null;
    const value = (m[3] !== undefined ? m[3] : (m[4] ?? '')).toLowerCase();
    if (!value) continue;
    if (rawField && FIELDS.has(rawField)) {
      terms.push({ kind: 'field', field: rawField, value, negate });
    } else {
      terms.push({ kind: 'text', value, negate });
    }
  }
  return { terms };
}
