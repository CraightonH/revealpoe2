# GGPK data mining

How we reach raw PoE2 game data tables that RePoE-fork does **not** export — most
importantly the **cultivated / mutated unique mod pools** tied to Vaal uniques and
the Vaal Cultivation Orb (GGG's "Fate of the Vaal" content, internal codename
prefix `Incursion2*`).

This is a **manual datamining** capability: it lands the raw tables on disk and
gives you tools to explore them. It is **not** wired into the graph builder — the
wiki still reads only `build/graph.json`. Deciding what to promote into the graph
comes after we understand what the tables contain.

## Start here (fresh session)

```
npm install                       # once — adds the pathofexile-dat parser
npm run fetch:dat                 # mirror all ~1020 raw tables (idempotent)
npm run dat -- grep <keyword>     # find a table by name/column (add --values for cell search)
npm run dat -- schema <Table>     # columns + what it references / is referenced by
npm run dat -- dump <Table> --resolve   # rows as JSON, foreign keys resolved to labels
```

`data/source/ggpk-poe2/CATALOG.md` (generated) is the map of every mirrored table
with row counts and relationships.

### The target data

| Table | What it holds |
|---|---|
| `Incursion2MutatedUniqueModsClient` | **The cultivated/mutated unique mod pool** — `{ Id, Mods:[→Mods] }` |
| `Incursion2Crafting` | Cultivation currency/bench behavior + icons |
| `Incursion2CorruptionCurrencies` | Currency ↔ eligible item-class mapping |
| `EndgameCorruptionMods` / `EndgameCleansedMods` | Corruption-outcome weighted mod pools |
| `CurrencyItems` | Master currency table (Vaal Cultivation Orb base row) |
| `Mods` / `ModType` | Modifier definitions; resolve display text via stat translations |
| `Words` / `UniqueOrigins` | Unique **names** live in `Words`; `UniqueOrigins` segments Vaal uniques |

Grep everything for the mechanic prefix: `npm run dat -- grep incursion2`.

## How it works

```
ggpk.exposed  ──HTTP──►  raw .datc64 tables  ──parse (pathofexile-dat + dat-schema)──►  JSON rows
```

`.datc64` is the current PoE2 table format: fixed-width binary rows with **no
column names**. The community [dat-schema](https://github.com/poe-tool-dev/dat-schema)
project supplies the ordered `(name, type)` list per table (covers PoE2). We pin
its `schema.min.json` in the mirror.

### Source: ggpk.exposed (chosen)

[ggpk.exposed](https://ggpk.exposed) decodes the game's bundle system and serves
every file over HTTP — so **no game install, no Oodle/native tooling**, and it
always reflects the current live patch. It's the same service the image pipeline
(`scripts/fetch-images.js`) already depends on.

- Enumerate: `GET https://ggpk.exposed/files?q=index&adapter=poe2&path=poe2://data/balance`
- Download raw bytes: `GET https://ggpk.exposed/files?q=download&adapter=poe2&path=poe2://data/balance/<name>.datc64`
- PoE2 quirk: tables live under `Data/Balance/` (`data/balance/`), **not** `Data/`
  root as in PoE1. Localized copies sit in per-language subfolders, which we skip.
- The **image** host (`image.ggpk.exposed/...?format=webp`) is a different route
  and 500s on `.datc64` — use the `q=download` endpoint for data.

### TLS gotcha

`npm run fetch:dat` runs with `SSL_CERT_FILE` / `NODE_EXTRA_CA_CERTS` unset (via
`env -u` in the npm script) — the corporate CA bundle stalls TLS to Cloudflare
(same reason CLAUDE.md unsets them for `build:images` / `fetch:tree`). The offline
`dat` reader needs no such handling.

### Fallback: `pathofexile-dat` over GGG's CDN

The [`pathofexile-dat`](https://github.com/SnosMe/poe-dat-viewer) CLI can pull
tables straight from GGG's patch CDN (`patch-poe2.poecdn.com`) instead of
ggpk.exposed. We use its **parser** but not its CDN loader, because the CDN path
requires manually supplying the PoE2 **`4.x` internal build string** (the
community auto-tracker is PoE1-only) and adds patch-protocol moving parts. Keep it
in mind only as a cross-check if ggpk.exposed is ever unavailable or suspect.

## Components

| File | Role |
|---|---|
| `scripts/fetch-ggpk-dat.js` (`npm run fetch:dat`) | Mirror all balance tables + pin dat-schema. Idempotent (size-gated), prunes orphans. |
| `scripts/ggpk/dat.js` | Pure `.datc64` → JSON decoder. The one place decoding lives. |
| `scripts/ggpk/cli.js` (`npm run dat`) | `ls` / `schema` / `grep` / `dump` / `catalog`. |
| `scripts/ggpk/catalog.js` | Generates `CATALOG.md`. |
| `scripts/ggpk/dat.test.js` + `__fixtures__/` | Offline decode test (committed fixture + mini schema). |

Mirror layout (gitignored, regenerable — like the rest of `data/source/`):

```
data/source/ggpk-poe2/
  tables/<name>.datc64   raw mirror (English, ~1020 tables)
  schema.min.json        pinned dat-schema
  _manifest.json         fetch metadata
  CATALOG.md             generated navigation map
```

## Gotchas

- **Column order is load-bearing.** The decoder trusts dat-schema column order to
  compute byte offsets; a wrong/partial schema misaligns every column after the
  bad one (visible as garbage in `dat dump`). Cross-check against ggpk.exposed's
  own web viewer when a table looks off.
- **dat-schema lags new content.** A brand-new league table may have unnamed
  columns until the community adds them; it still parses structurally (untyped
  columns come back `null` rather than crashing the dump). The target table is
  already schema'd.
- **Client/server split.** The authoritative mutated-mod list may partly live in
  a non-`Client` sibling (`Incursion2MutatedUniqueMods`) that dat-schema may not
  document — the full mirror is on disk, so `dat grep incursion2` finds it
  regardless.
