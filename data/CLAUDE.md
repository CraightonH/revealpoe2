# data/ — game data

Two trees, different rules:

- **`data/source/`** — raw, re-scrapeable **mirrors** of upstream game data. Large
  (~250M+), **gitignored**, regenerable. **Never hand-edit** — edits die on the
  next scrape. Only the per-folder `CLAUDE.md` guides are committed (a `.gitignore`
  exception), so a fresh clone knows how to repopulate each empty folder. Each
  subfolder has its own `CLAUDE.md` with regenerate + usage instructions.
- **`data/manual/`** — hand-authored overlays (committed). Declarative,
  schema-validated JSON merged **last** by `scripts/graph/manual.js`. This is where
  hand-crafted game knowledge belongs — see the **Data Provenance** policy in the
  repo-root `CLAUDE.md`.

## Nothing here is read at runtime

`src/` never reads `data/` directly. The build compiles all of it into one
artifact, `build/graph.json` (`npm run build:graph` → `scripts/graph/*`), and the
app reads only that. So: add/refresh data here → rebuild the graph → the app sees
it. See **Data Architecture: the Graph** in the root `CLAUDE.md`.

## Repopulate everything (fresh checkout)

```
python scripts/scrape.py      # repoe-poe2 + pob-uniques  (RePoE-fork mirror)
npm run fetch:tree            # ggg-poe2  (GGG passive-tree data + atlases)
npm run fetch:dat             # ggpk-poe2 (raw .datc64 tables via ggpk.exposed)
npm run build:images          # public/img/ icons (optional; placeholder fallback otherwise)
```

Each is idempotent and re-runnable after a game patch. Per-source detail lives in
`data/source/<name>/CLAUDE.md`.
