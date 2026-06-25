# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal

A modern, beginner-friendly Path of Exile 2 wiki. The target experience is the opposite of poe2db.tw — surfaces relationships between data (e.g. which support gems work with a skill gem) without requiring the user to already know those relationships. Game data lives in-repo under `data/source/` (gitignored — large and regenerable; see **Data Sources**).

## Data Sources

All game data is in `data/source/` — gitignored (large, ~250M, regenerable via `scripts/scrape.py`), so never committed. Paths below are relative to `data/source/`. (Hand-authored overlays under `data/manual/` *are* committed — see **Data Provenance**.)

### Primary tables (most-used)

| File | Contents |
|------|----------|
| `repoe-poe2/base_items.json` | All base item types — inventory size, item class, tags, attribute reqs, `visual_identity.dds_file` for icons |
| `repoe-poe2/skill_gems.json` | Skill/support gems — color, crafting_level, crafting_types, grants_skills, recommended_supports, icon_dds_file |
| `repoe-poe2/skills.json` | Skill effects (active + granted-by-mod) |
| `repoe-poe2/mods.json` | Mod definitions with stat ranges and item eligibility |
| `repoe-poe2/stat_translations/` | Stat-id → display text (human-readable mod descriptions) |
| `pob-uniques/*.json` | Full unique item stats (PoB hand-maintained); each file is a list of raw text blocks |

### Key cross-references

- `base_items.json` keys (`Metadata/Items/...`) → files under `repoe-poe2/Metadata/Items/`
- `skill_gems.json` `recommended_supports[]` → other keys in `skill_gems.json`
- `mods.json` ↔ `base_items.json` via item tags and `mods_by_base.json`
- Stat ids on mods/skills → display text via `stat_translations/`
- PoB unique name (line 1) → `repoe-poe2/uniques.json` for `dds_file`

### Icons

**Images are self-hosted, not hotlinked.** `src/data/images.js` `ddsUrl(dds)` returns a same-origin path `/static/img/{dds without .dds}.webp`. The build step `build:images` (`scripts/fetch-images.js`) mirrors every referenced `.dds` from ggpk.exposed into `public/img/` (gitignored, ~120M) as webp, so the live site has **no runtime third-party CDN dependency**. Source `dds_file` fields: `visual_identity.dds_file` (items), `icon_dds_file` (skill gems).

Drift is handled by the fetcher: the referenced set comes from `build/graph.json` (new content → new fetch); changed art is caught via ggpk ETags + `If-None-Match` (304 = skip, 200 = re-download); orphans are pruned. It's idempotent and rate-limit-aware (concurrency 8 + backoff) — safe to run every deploy. A few assets 500 upstream on ggpk's side; those fall back to the placeholder.

Offline/missing fallback: render a placeholder using `visual_identity.id`/`name` — deterministic color from hash, initials as label, wired via `onerror` on every icon `<img>`. See `docs/image-assets.md` for the full pattern including CSS.

## Data Architecture: the Graph

`src/` **never reads `data/source/` at runtime.** The build compiles all source files into one artifact, `build/graph.json` (a `{ meta, nodes, edges }` property graph), and the app reads only that.

- **Build**: `npm run build:graph` → `scripts/graph/cli.js` → `build.js`. Each domain module (`gems.js`, `bases.js`, `uniques.js`, `passives.js`, `affixes.js`, `keywords.js`) returns nodes + edges from source; `build.js` merges them, validates against `schema.js` (`validate.js`), and stamps `meta.sourceHash`.
- **Runtime**: `src/data/graph.js` loads the artifact and exposes `getNode`, `nodeBySlug`, `nodesByKind`, `edgesFrom`, `edgesTo`. The `src/data/*` modules are presentation adapters — they read nodes/edges and own *only* rendering. No data resolution at runtime.
- **Nodes** are keyed by source Metadata id and carry `kind`, `name`, `slug`, `props`. **Edges** carry `type`, `from`, `to`. Relationships (`grants`, `recommends_support`, `rolls_on`, `has_base`, `in_class`, `default_skill`, …) are edges — **traverse them, don't recompute**. A reverse lookup is `edgesTo(id, type)`.
- A boot-time staleness guard compares `meta.sourceHash` to the source so a stale artifact is caught.

## Data Provenance & Hand-Crafted Data Policy

**The wiki's value is relationships, and not all of them exist in RePoE source.** Expect recurring "add this relationship/data that isn't in repoe" requests. This policy is **critical and not optional**: hand-crafted data MUST stay isolated from, and auditable against, source-generated data.

### Decide first: curate, or accept the hole

Not every gap should be filled. Judge on two axes:
- **Value** — relationships are the core UX; a missing relationship matters more than a missing scalar.
- **Churn & derivability** — prefer stable game facts expressible as a compact *rule*, not a sprawling hand table.

Curate high-value, low-churn, rule-compressible facts (e.g. "default attack skill per weapon class"). Accept the hole for low-value or high-churn data (e.g. per-base tuning numbers) — wait for source instead. When unsure, surface the trade-off rather than silently fabricating data.

### Where hand-crafted data lives

- **NEVER edit `data/source/`** — it is a re-scrapeable mirror; hand edits die on the next `scripts/scrape.py`.
- Hand-authored overlays live in THIS repo under `data/manual/*.json` — declarative, schema-validated data files (not code) so game knowledge can be edited without touching build logic.
- The builder merges overlays via `scripts/graph/manual.js`, applied **last** so it can reference source nodes.

### Provenance is mandatory — three tiers

Every node and edge carries a `source`:
- `repoe` — straight from scraped source files.
- `manual` — irreducible hand-authored facts (the overlay input itself).
- `derived` — computed by the builder, from source OR from manual rules; carries a `via` pointer to its basis (e.g. `manual:weapon-default-skills`).

### Author rules, not enumerations

Keep the hand-maintained surface as small as the irreducible fact; let the builder expand it. Don't hand-write 27 bow→skill edges — write one `gem→class` line and have `manual.js` emit a `derived` edge for every base in that class. New bases from a future scrape pick up the relationship automatically.

### Guardrails (enforced in the build)

- **Referential integrity** — every manual reference must resolve to a live source node. A patch that renames a key must **fail the build**, never silently drop the relationship.
- **Retirement detection** — if source later ships a relationship we hand-authored, the build **warns** on the overlap so the manual copy can be deleted. Source wins.
- **Provenance summary** — `meta.provenance` records counts by source; `meta.manualHash` lets the staleness guard distinguish "source changed" from "overlay changed".

## UI Fidelity Goal

Item and gem tooltips should imitate the in-game look and feel as closely as possible. The reference implementation is **poe2db.tw** — inspect its HTML/CSS for layout patterns before building new popup styles.

Key layout patterns already established (do not drift from these):
- `.newItemPopup` — outer popup wrapper; `--card-border` / `--card-glow` CSS variables set per rarity
- `.itemHeader.doubleLine` — header banner with item name and type line; gems use `GemHoverTitle.dds` background, unique items override with a dark gradient header
- `.Stats` / `.explicitMod` / `.implicitMod` / `.separator` / `.FlavourText` — inner content structure matching poe2db class names exactly
- **Item art goes outside the popup** in `.itemboximage` beside `.newItemPopup` (poe2db pattern) — not inside the header
- poe2db URL pattern: `https://poe2db.tw/us/{ItemName_snake_case}` — use to cross-reference layout and class names

## Architecture Decisions

Stack: Express + Nunjucks server-rendered pages, reading the pre-built `build/graph.json` artifact (see **Data Architecture: the Graph**). **Production ships as a pure static prerender of this same app to Cloudflare Pages** — the server runs at build time, not at runtime (see **Deployment: Static Site**). When building:

- **Data access layer** is the graph: `src/data/graph.js` plus per-domain presentation adapters (`src/data/gems.js`, `uniques.js`, …). All resolution happens at build time in `scripts/graph/*`; runtime code only reads nodes/edges and renders. Never reintroduce `data/source/` reads into `src/`.
- **Relationships** are the primary UX value — skill gem → recommended supports → what those supports do → which weapon types they apply to. Model them as graph edges and make them traversable (and reverse-traversable via `edgesTo`).
- **Beginner-first**: surface `gem_tags.json` display names, `keywords.json` glossary, and stat translation text so users never see raw stat IDs.
- **Search** works across gem names, item names, and stat descriptions via a pre-built full-text index — no backend. The matching/ranking engine (`public/js/query-core.js`) is a pure module imported by **both** the server (`src/data/search.js`, `theorycraft.js`) and the browser, so the static site's client-rendered search can't diverge from the server. Change matching there, once.

## Development Workflow

**Develop on the server. The static build is a packaging + verification step, not a second dev surface.** The prerenderer doesn't render anything itself — it boots the real Express app (`createApp()`) and crawls it, so what you see at `localhost` is exactly what gets frozen into `dist/`. Iterating against the running server is the fast loop; you only invoke the static build to *release* and to catch the handful of static-only failure modes (below).

- **Inner loop:** `npm run dev` (`node --watch src/index.js`; `predev` rebuilds graph + client artifacts). Edit templates / CSS / `src/data/*` / `data/manual/*` and refresh. `--watch` restarts on save.
- **Tests:** `npm test` (`pretest` rebuilds the graph). 284+ node:test cases; keep them green.
- **⚠️ Images in dev:** `ddsUrl()` returns `/static/img/...webp`, which the dev server serves from `public/img/` — **but `predev` does NOT run `build:images`** (no network round-trip / rate-limited CDN on every start). On a fresh checkout or after a scrape, run `npm run build:images` **once** so real icons appear. Skip it and you get the deterministic placeholder fallback — by design, fine for most UI work; only run it when working on icon layout.
- **Static-only failure modes** — verify via `npm run build:static` (or a preview deploy) before promoting, because they don't exist on the dev server: (1) client-rendered `/search` & `/theorycraft` (dev uses live htmx routes; static strips `hx-*` and renders from `public/generated/*.json` — divergence risk); (2) a new client-fetched URL not being crawler-discoverable (404s only on static — see Deployment); (3) Pages routing / MIME / TLS.

### Complete lifecycle

```
edit code/templates/data  ─► npm run dev            (iterate on localhost)
                                  │
game patch? ─► python scripts/scrape.py ─► npm run build:images   (refresh data + icons)
                                  │
ready to ship ─► npm run build:static                (full local build; catches static-only breakage)
                                  │
                          npm run deploy              (build:static + wrangler; non-main branch ⇒ PREVIEW)
                                  │
                          verify on the .pages.dev URL (Node fetch, not curl)
                                  │
                          merge to main ─► npm run deploy   (⇒ PRODUCTION)
```

The content-update loop after a game patch is just: `scrape.py` → `npm run deploy` (deploy runs `build:images` itself, so icons sync automatically — the manual `build:images` above is only for seeing them in `dev` first).

## Deployment: Static Site

Production is a **static prerender** of the app, hosted on **Cloudflare Pages** (free tier). The full reference is `docs/deploy-cloudflare.md`; the essentials:

- **One command:** `npm run deploy` → `build:static` (`build:graph` → `build:index` → `scripts/prerender.js` into `dist/`) → `wrangler pages deploy`.
- **Build locally, upload `dist/`** — never Git-integration CI. `data/source/` is gitignored, so Cloudflare's build box has no data to compile; the local machine that has the data is the build box. Content update loop after a patch: `python scripts/scrape.py` → `npm run deploy`.
- **Prerender is a link crawler** (`scripts/prerender.js`): it boots the real app and walks every internally reachable URL (`href`, `hx-get`, `data-card-url`, and `data-keyword` → `/api/keyword/*`), so it renders exactly what's linked and a dead internal link **fails the build**.
- **⚠️ New client-fetched endpoints must be crawler-discoverable.** The crawler only finds URLs present in those attributes. JS that fetches a URL built another way (bare id, computed path) won't be prerendered and will 404 on the static site (this is the bug that hit keyword popups). Expose it via a crawlable attribute, or extend `extractLinks()` in `prerender.js`.
- **Dynamic features are client-rendered.** `/search` and `/theorycraft/results` are excluded from the crawl; `search-client.js` / `theorycraft-client.js` render from prebuilt artifacts in `public/generated/` (`search-index.json` = `allDocs()`; `browse-cards.json` = real macro-rendered cards) using the shared `query-core.js`. They strip the `hx-*` attributes at load so htmx never fires. The server routes + `hx-get` attributes stay (tests, dev parity, no-JS fallback) — do not remove them.
- **Verify against the deployed site, not just unit tests** — Pages routing, module MIME types, and client rendering don't show up in `npm test`. Use Node `fetch` or headless Chrome, **not `curl`** (the corporate `SSL_CERT_FILE` breaks TLS to Cloudflare).

## Data Notes

- `pob-uniques/*.json` format: each file is a list of strings. Each string is a multi-line block where line 1 = unique name, rest = PoB text format with `{tags:...}` and `{variant:...}` annotations.
- `stat_translations/specific_skill_stat_descriptions/` has 559 per-skill files — load on demand, not at startup.
- The passive skill trees are in `repoe-poe2/passive_skill_trees/` — the Default tree is the character passive tree; Atlas/EndgameMap are endgame.
- Data was scraped 2026-06-03 from RePoE-fork. Re-scrape with `python scripts/scrape.py` after game patches (writes to `data/source/`).

## Environment

No environment setup is required for the data path — `scripts/graph/source.js` resolves game data from the in-repo `data/source/` directory automatically. The legacy `POE2DATADIR` env var (in `.env`) is still honored as an override pointing at a sibling location with a `data/` subdir, but is only used when that location actually contains the scraped data; otherwise the in-repo `data/source/` wins.
