# GGPK Data Mining Pipeline — Design

**Date:** 2026-07-14
**Status:** Approved (design), pre-implementation
**Scope:** Land raw PoE2 game data tables (`.datc64`) that RePoE does not export, into the gitignored `data/source/` tree, plus a navigable reader for **manual** datamining. **Graph-builder integration is explicitly out of scope for this iteration.**

## Motivation

RePoE-fork (our current sole data upstream) does **not** export the *cultivated* (a.k.a. *mutated*) unique mod pools — the mechanic tied to Vaal uniques and the Vaal Cultivation Orb (GGG's "Fate of the Vaal" content, internal codename prefix `Incursion2*`). This data exists only in the raw game tables. To reach it we need our own path to the raw GGPK/bundle data.

Confirmed empirically during design: the target table **`Incursion2MutatedUniqueModsClient`** exists and is reachable, with schema `{ Id: string, Mods: [→Mods] }` — a named pool pointing at a list of `Mods` rows. We successfully downloaded and parsed its real bytes end-to-end (1 row, `Id="OriginalMods"`, ~280 foreign keys into `Mods`).

This iteration gets those raw tables onto disk and gives us tools to explore them. Deciding *what* to extract into the graph, and building that graph integration, is deliberately deferred until manual exploration tells us what the pools actually contain.

## Background: the PoE2 data format chain

```
_.index.bin  ──(Oodle decompress)──►  path list + which-bundle + offset/size
*.bundle.bin ──(Oodle decompress)──►  raw files
Data/Balance/*.datc64                 ← the game data tables (fixed-width binary rows, no column names)
```

- `.datc64` is the current table format (PoE2 + recent PoE1). Rows are positional binary with **no embedded column names**.
- Column names/types come from the community **dat-schema** project (`github.com/poe-tool-dev/dat-schema`), which covers PoE2 (~570 PoE2 tables; combined `schema.min.json` has 1501 tables total, filtered by a `validFor` PoE2 bit).
- **PoE2 quirk:** tables live under `Data/Balance/` (lowercase `data/balance/` in the mirror), **not** `Data/` root as in PoE1. ~1020 tables; localized copies sit in per-language subfolders which we skip.

## Approach decision

Two install-free, WSL/macOS-native paths were considered:

- **A — ggpk.exposed HTTP mirror (CHOSEN).** Enumerate + download raw `.datc64` over HTTP, parse locally with `pathofexile-dat`'s parser + dat-schema. Proven working during design. Reuses infrastructure the repo already trusts (`fetch-images.js` already depends on ggpk.exposed). **Self-updating** — always serves the current live patch, no version string to track.
- **B — `pathofexile-dat` CLI over GGG's patch CDN (fallback, documented only).** Requires manually supplying the PoE2 `4.x` internal build string (community auto-tracker is PoE1-only) and adds CDN/patch-protocol moving parts. More brittle for a hands-off mirror. Kept in docs as a cross-check option.

**Rationale for A:** fewer moving parts, no patch-version bookkeeping, consistent with the existing image pipeline.

### ggpk.exposed API (verified)

- **Enumerate:** `GET https://ggpk.exposed/files?q=index&adapter=poe2&path=poe2://data/balance`
  → `{ files: [{ basename, type, ... }] }`. Basenames returned lowercase.
- **Download raw bytes:** `GET https://ggpk.exposed/files?q=download&adapter=poe2&path=poe2://data/balance/<name>.datc64`
  → `application/octet-stream`, `access-control-allow-origin: *`. (`q=preview` also works; we use `q=download` as the documented download verb.)
- The **image** host (`image.ggpk.exposed/...?format=webp`) is a *different* route and 500s on `.datc64` — do not use it for data.
- **TLS:** hit ggpk.exposed with `SSL_CERT_FILE` / `NODE_EXTRA_CA_CERTS` unset (corporate CA bundle stalls TLS to Cloudflare) — same reason CLAUDE.md unsets them for `build:images`/`fetch:tree`. Dev environments are WSL/macOS (not native Windows), so the existing `env -u …` npm-script convention is retained for consistency.

### dat-schema → parser wiring (verified)

- Pin `schema.min.json` from the dat-schema `latest` release. Filter tables by the PoE2 `validFor` bit. (The release *tag* date is intentionally stale; real date is `createdAt` inside the JSON.)
- Parse with `pathofexile-dat` (npm, v15.x). Its `dat.js` barrel eagerly imports a **browser-oriented wasm** analysis module that throws under Node; we import the pure parser **submodules directly** instead:
  `dist/dat/dat-file.js` (`readDatFile`), `dist/dat/header.js` (`getHeaderLength`), `dist/dat/reader.js` (`readColumn`).
  Because the package `exports` map blocks subpath imports, resolve the package location via `require.resolve('pathofexile-dat/package.json')` and import the dist files through `url.pathToFileURL(path.join(dir, 'dist/dat/<file>.js'))` (correct on Linux/macOS; also drive-letter-safe).
- Map dat-schema column types → `pathofexile-dat` header `type`, accumulating each column's byte `offset` via `getHeaderLength`:
  `bool→boolean`, `string→string`, `i16/i32→integer{unsigned:false}`, `u16/u32/enumrow→integer{unsigned:true}`, `f32→decimal`, `row→key{foreign:false}`, `foreignrow→key{foreign:true}`; the schema's `array:true` sets `type.array=true`.

## Architecture

Three units + docs, each independently testable.

### 1. Fetcher — `scripts/fetch-ggpk-dat.js` (npm: `fetch:dat`)

A third raw-upstream fetcher alongside `scripts/scrape.py` (RePoE) and `scripts/fetch-ggg-tree.js` (GGG web API). Responsibilities:

- Enumerate `data/balance/` via the ggpk.exposed index API (English top-level only; skip per-language subfolders).
- Download **all ~1020 `.datc64` tables** into the mirror. Concurrency-limited (8) with exponential backoff; disk-cached and idempotent (skip unchanged by size/ETag, like `fetch-images.js`).
- Fetch + pin `schema.min.json`.
- Write `_manifest.json` (fetch time, table count, per-file size/hash, ggpk source note).

Output layout (gitignored — regenerable, consistent with the rest of `data/source/`):

```
data/source/ggpk-poe2/
  tables/<name>.datc64     # raw mirror, all balance tables (English)
  schema.min.json          # pinned dat-schema
  _manifest.json           # fetch metadata
  CATALOG.md               # generated navigation map (see CLI)
```

### 2. Parser — `scripts/ggpk/dat.js`

Pure module, no network. Given a table name, loads its cached `.datc64` + the pinned schema and returns `{ rowCount, rowLength, columns, rows }` as plain JSON. Owns the submodule-import shim, the type→header mapping, and offset accumulation described above. This is the single place `.datc64` decoding lives; both the CLI and any future graph module consume it.

### 3. Read CLI — `scripts/ggpk/cli.js` (npm: `dat`)

Optimized for **cold navigation in a fresh session with no prior context** (the stated success criterion). Subcommands:

- `dat ls [pattern]` — list/grep table names present in the mirror (with row counts when cheap).
- `dat schema <Table>` — column names + types, **plus** cross-references: which tables this one references (from its `foreignrow` columns) and which tables reference *it* (reverse scan of the schema). Orients you fast.
- `dat grep <keyword>` — search across table names, column names, and string cell values. The "I don't know the table name yet" entry point.
- `dat dump <Table> [--resolve] [--limit N]` — parse rows to JSON on stdout (or a file). `--resolve` follows `foreignrow` columns **one level**, and for `Mods` targets additionally resolves to the mod `Id` + translated stat text, so a raw pool like `[2813, 3967, …]` renders as readable modifiers.
- `dat catalog` — (re)generate `data/source/ggpk-poe2/CATALOG.md`: every mirrored table, row count, and key xrefs — the durable fresh-session map. Also run automatically at the end of `fetch:dat`.

### 4. Docs — `docs/ggpk-datamining.md`

- The mechanic→table map: Vaal cultivation = `Incursion2*`; target tables (`Incursion2MutatedUniqueModsClient`, `Incursion2Crafting`, `Incursion2CorruptionCurrencies`, `EndgameCorruptionMods`/`EndgameCleansedMods`, `CurrencyItems`, `Mods`/`ModType`/`Words`/`UniqueOrigins`).
- Both approaches (A chosen, B as CDN fallback with the `4.x` caveat).
- Setup: `npm install` (adds `pathofexile-dat` dep) → `npm run fetch:dat` → `npm run dat -- …`. No game install, no native builds, WSL/macOS identical.
- The TLS gotcha and the "start here in a fresh session" section pointing at `CATALOG.md` + `dat grep`.
- One-line pointer added to CLAUDE.md under Data Sources.

## Dependencies

- Add `pathofexile-dat` (^15.x) to `devDependencies`. It ships `ooz-wasm` — pure JS, no native build, no `oo2core` DLL. (We only use its parser submodules; we do not use its CDN/bundle loader or the wasm analysis module.)

## Setup / new-environment story

`git clone` → `npm install` → `npm run fetch:dat` (pulls the raw mirror, ~tens of MB) → `npm run dat -- ls`. Idempotent; re-run `fetch:dat` after a game patch to re-mirror the then-current tables (self-updating via the live ggpk mirror).

## Testing

- **Parser unit test** (`scripts/ggpk/dat.js`): parse a small committed fixture `.datc64` (e.g. `endgamecorruptionmods` — 15 rows) against the pinned schema; assert row count, a known foreign-key value, and array handling. Fixture + a frozen mini-schema committed so the test is offline and deterministic (does not hit the network or depend on the gitignored mirror).
- **CLI smoke test**: `dat schema` / `dat grep` against the fixture-backed parser.
- Fetcher is network-bound and idempotent; not unit-tested against the live service (matches how `fetch-images.js`/`fetch-ggg-tree.js` are treated) — verified manually.

## Out of scope (this iteration)

- No `scripts/graph/*` module, no new nodes/edges, no runtime/UI surface.
- No CDN/patch-version tracking (approach B stays documentation-only).
- No localization tables (English only).

## Risks / gotchas

- **Client/server split:** the authoritative mutated-mod list may partly live in a non-`Client` sibling (`Incursion2MutatedUniqueMods`) that dat-schema may not document. Mitigation: the full mirror is on disk, so `dat grep incursion2` finds every related table regardless of schema coverage; unschema'd tables still parse structurally (columns may be unnamed).
- **dat-schema lag:** brand-new content tables may have unnamed columns until the community adds them. Acceptable for manual exploration; the target table is already schema'd.
- **Ordering assumption:** the parser trusts dat-schema column *order* to compute offsets. If a table's schema is wrong/partial, downstream columns misalign — visible as garbage in `dat dump`, and cross-checkable against ggpk.exposed's own viewer.
