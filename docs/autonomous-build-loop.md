# Autonomous build loop prompt

Paste the block below after `/loop` (no interval — let the agent self-pace) in a fresh
session at the repo root. Target model: latest Sonnet.

---

You are autonomously building out the Path of Exile 2 wiki in this repo. Read `CLAUDE.md`
first — it is the source of truth for data sources, the icon CDN pattern, and architecture
rules. Then advance the wiki by **exactly ONE self-contained, shippable feature slice per
iteration**, fully tested and committed, and schedule the next iteration. Do not try to do
everything at once.

## North star
A beginner-friendly wiki that surfaces RELATIONSHIPS between data (the opposite of
poe2db.tw). Users should never see raw stat IDs or metadata keys — always display names,
`gem_tags.json` labels, `keywords.json` glossary text, and stat-translation text. The most
valuable thing you can add is traversable links between entities.

## Stack & conventions (do not drift from these)
- Express 5 + Nunjucks views + vanilla client JS + `node:test`/supertest. No framework
  rewrite. Small, well-justified libraries are OK (e.g. a search-index lib) — but prefer
  vanilla and never add a build step.
- Data is read-only via `src/data/loader.js` `loadJson('repoe-poe2/<file>.json')`. Each
  entity type gets a thin `src/data/<thing>.js` module exposing typed query functions
  (by name, slug, tag, class) — never scatter raw JSON access through routes/views.
- Reuse existing primitives: `slug.js`, `images.js` `ddsUrl()`, `keywords.js`
  `renderGameText(text, hasDefinition)`, `keywordDefs.js`, `statText.js`, `gemTags.js`.
  Route game text through `renderGameText` so keywords become hoverable.
- Big files (`skills.json` 27M, `mods.json` 13M, `ascendancies.json` 17M, per-skill stat
  files) are loaded lazily on demand — never eagerly at startup. Watch memory.
- Match the surrounding code's style, comment density, and naming. Read neighboring
  modules before writing.

## Per-iteration workflow (follow in order; use your superpowers skills)
1. **Pick the next slice** from the Backlog below (top unchecked item, or the smallest
   next increment of an in-progress one). State which slice you chose in one line.
2. **Plan briefly.** Use `superpowers:writing-plans` to drop a short plan in
   `docs/superpowers/plans/`. Verify data facts FIRST by actually grepping/reading the
   real JSON in `$POE2DATADIR/data/` (load `.env`) — record exact keys, sample values, and
   edge cases the tests will assert. Do not invent field names.
3. **Implement with TDD** (`superpowers:test-driven-development`): write `node:test` tests
   in `test/` against verified data facts, then the data module, then route + Nunjucks
   view/macro, then CSS. Add a `<thing>.test.js` per new data module.
4. **Wire navigation.** Every new entity type must be reachable: link it from search
   and/or the home page and cross-link it to related entities (e.g. unique → its base item
   → mods on that base; gem → uniques that affect it). Relationships are the point.
5. **Verify before claiming done** (`superpowers:verification-before-completion`):
   `npm test` is green, `npm start` boots clean (no unhandled errors, reasonable memory),
   and the new page renders for at least one real slug. Spot-check icons fall back
   gracefully when a `dds_file` is missing.
6. **Commit.** On a feature branch off `master` (create `feat/<slice>` if not already on
   one; never commit to `master` directly, never push, never merge to `main`). Conventional
   commit message, no Co-Authored-By line. Archive the finished plan under
   `docs/superpowers/archive/`.
7. **Schedule the next iteration** via the loop, repeating this same prompt. If every
   Backlog item is checked and verified, STOP and post a summary instead of looping.

## Backlog (items-first; do top-down, deepen before broadening)
1. **Unique items.** Parse `pob-uniques/*.json` (each file = list of multi-line text
   blocks; line 1 = name, rest = PoB `{tags:...}`/`{variant:...}` text). Icon via
   `uniques.json` `dds_file` keyed by name. Unique detail page + index, styled like the
   gem card (unique-tier border). Link unique → its base item.
2. **Base item browser.** `base_items.json` grouped by `item_classes.json`. Browse by
   class (weapons, armour, etc.), base detail page with inventory size, tags, attribute
   reqs, icon. Link base → uniques on that base, and base → applicable mods.
3. **Mods / affixes.** `mods.json` + `mods_by_base.json`, descriptions via
   `stat_translations/`. Show which bases/tags a mod can roll on and its tiers/ranges.
   Cross-link from base item pages.
4. **Passive tree & ascendancies.** `passive_skill_trees/` (Default = character tree) and
   `ascendancies.json`. Start with searchable notable/keystone descriptions before
   attempting tree visualization.
5. **Search upgrade.** Extend `src/data/search.js` beyond gem names to items, uniques, and
   stat-description text. A small pre-built index lib is acceptable here if justified.

## Hard rules
- One slice per iteration. Ship vertical (data→route→view→test→nav), not horizontal.
- Never break existing tests or the gem pages. `npm test` must stay green every iteration.
- If a data fact you assumed turns out wrong, fix the root cause and the test — don't paper
  over it. Leave a breadcrumb note in the plan.
- If genuinely blocked (missing/ambiguous data, a real product decision), STOP the loop and
  write a short note in `docs/` describing what's missing and the options — don't guess at
  product direction.
