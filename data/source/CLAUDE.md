# data/source/ — raw upstream mirrors (regenerable, gitignored)

Everything here is a **mirror of an upstream source**, reproduced by a script.
It is **gitignored** (large + regenerable) — only these `CLAUDE.md` guides are
committed.

**NEVER hand-edit files here.** Any manual change is silently destroyed the next
time the mirror is regenerated. Hand-authored game knowledge belongs in
`data/manual/*.json` (committed overlays) — see the **Data Provenance** policy in
the repo-root `CLAUDE.md`.

## The mirrors

| Folder | Regenerate with | Upstream | Guide |
|---|---|---|---|
| `repoe-poe2/` | `python scripts/scrape.py` | RePoE-fork (repoe-fork.github.io/poe2) | `repoe-poe2/CLAUDE.md` |
| `pob-uniques/` | `python scripts/scrape.py` | PoB unique data (repoe-fork.github.io/pob-data) | `pob-uniques/CLAUDE.md` |
| `ggg-poe2/` | `npm run fetch:tree` | GGG passive-tree web API + atlases | `ggg-poe2/CLAUDE.md` |
| `ggpk-poe2/` | `npm run fetch:dat` | ggpk.exposed raw `.datc64` tables | `ggpk-poe2/CLAUDE.md` |

If a folder is empty, run its regenerate command. Each subfolder's `CLAUDE.md`
covers how to work with the data once it's there.

Consumed only at **build time** by `scripts/graph/*` (→ `build/graph.json`);
`src/` never reads these files at runtime.
