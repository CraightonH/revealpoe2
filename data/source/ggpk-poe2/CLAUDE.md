# ggpk-poe2/ — raw GGPK game data tables (.datc64)

Raw PoE2 game data tables mined directly from **ggpk.exposed** (which decodes the
game's bundle system over HTTP — no game install, no native tooling). This reaches
data RePoE does **not** export — most importantly the **cultivated / mutated unique
mod pools** (`Incursion2MutatedUniqueModsClient`, tied to Vaal uniques + the Vaal
Cultivation Orb). Regenerable mirror — **never hand-edit** (see `../CLAUDE.md`).

**Manual datamining only — NOT wired into the graph.** The wiki still reads only
`build/graph.json`; this folder is for exploration until we decide what to promote.

## Regenerate (empty or stale)

```
npm install            # once — adds the pathofexile-dat parser
npm run fetch:dat      # mirror all ~1020 balance tables + pin dat-schema
npm run fetch:dat -- --force     # re-download everything
```

Self-updating (always the current live patch). Writes `tables/<name>.datc64`,
`schema.min.json` (column names), `_manifest.json`, and `CATALOG.md`.

## Working with the data

`.datc64` is fixed-width binary with no column names; the pinned dat-schema supplies
them. Use the reader (offline; reads this mirror):

```
npm run dat -- ls <pattern>          # list tables
npm run dat -- schema <Table>        # columns + references / referenced-by
npm run dat -- grep <keyword>        # find a table (add --values to scan cells)
npm run dat -- dump <Table> --resolve  # rows as JSON, foreign keys resolved
npm run dat -- catalog               # regenerate CATALOG.md
```

`CATALOG.md` is the map of every mirrored table. **Full guide + recipes (mod →
stat text, enum resolution, jq): `docs/ggpk-datamining.md`.** Tooling lives in
`scripts/fetch-ggpk-dat.js` and `scripts/ggpk/`.
