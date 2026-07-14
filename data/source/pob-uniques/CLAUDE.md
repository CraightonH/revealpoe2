# pob-uniques/ — Path of Building unique item data

Full unique-item stats, **hand-maintained by the PoB community** (NOT present in
the game files / RePoE core export). One file per item class. Regenerable mirror —
**never hand-edit** (see `../CLAUDE.md`); to correct a unique, fix it upstream in
PoB, not here.

## Regenerate (empty or stale)

```
python scripts/scrape.py --only pob-uniques
```

Upstream `https://repoe-fork.github.io/pob-data/poe2/Uniques/`. Small (~33 files,
~160K).

## Working with the data

Each `*.json` is a **list of strings**. Each string is a multi-line block:
- **line 1** = the unique's name
- remaining lines = PoB text format, with `{tags:...}` and `{variant:...}`
  annotations.

Parsed at build time by `scripts/graph/uniques.js` into unique-item nodes; the
build hashes all files (sorted) for the staleness guard (`scripts/graph/build.js`).
Cross-reference a unique's name (line 1) → `../repoe-poe2/uniques.json` for its
`dds_file` icon. As always, read via the graph at runtime, not these files.
