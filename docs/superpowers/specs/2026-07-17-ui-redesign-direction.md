# UI Redesign — Direction Record (2026-07-17)

Status: **/gems shipped to production 2026-07-20** (Gem Index master–detail:
shared detail partial + pane fragments, local full-text search, content-scoped
card-size scaling, in-pane deep-link navigation). Remaining scope: propagate
the pattern to uniques/bases/passive pages + site chrome; CSS token
consolidation debt still open.

## Goal

Full-site UI redesign. The current skin "isn't bad, it just feels 10 years old."
Interactive elements are liked and stay; the *skin* and the *browsing feel* are
what's being redesigned.

## Invariants (owner-set)

1. In-game colorways preserved (rarity/element/gem colors, `public/css/tokens.css`).
2. Data integrity — all content real and verbatim.
3. Tooltip functionality preserved.
4. Passive tree untouched — faithful in-game replica.
   ⚠️ Its CSS is **interleaved in `app.css` (~lines 344–614 + tooltip blocks ~709–826)**,
   JS is the 8 `passive-*`/`build-*` files. Fence these in every implementation brief.
5. Must ship as a pure static site (Cloudflare Pages) — plain CSS + vanilla JS, no SSR.

### The two-zone rule (decided this session, supersedes a blanket image-placement rule)

- **Fidelity zone** — `.newItemPopup` popup interiors (gem/unique/base tooltips and
  detail popups): in-game-faithful layout is law; poe2db class names, header art,
  equipment art outside the popup in `.itemboximage`. Never re-imagined.
- **Exploration zone** — everything that *navigates to* those popups (browse pages,
  lists, filters, chrome): full artistic leeway, including dropping the
  mini-card-with-banner format. The original "header images must remain in place"
  constraint binds only the fidelity zone.

Owner explicitly confirmed (on seeing the Ledger): "we don't _need_ to strictly
follow the in-game looks" outside the fidelity zone.

## Redesign principles

1. Consistent structure — pages shouldn't feel like different sites.
2. Consistent elements — e.g. tooltips everywhere or nowhere; one unique-item
   element reused across all pages (templates already do this via shared macros).
3. Consistent code — DRY CSS. Known debt: `gem-card.css` and `app.css` bypass
   `tokens.css` with hardcoded literals (two parallel element palettes; an
   untokenized gold/parchment family `#c9aa71`/`#9a8f7a`/`#c8a13a`…). Any
   implementation should route all color through tokens.

## What was explored

### Round 1 — reskins of the existing markup (same grid, new paint)

| Variant | Artifact |
|---|---|
| A — Refined Classic (gold/parchment PoE identity, modern craft) | https://claude.ai/code/artifact/66a2f7ec-009a-4f44-b366-570dd7b6c55e |
| B — Modern Dark App (Linear/shadcn chrome; game styling only in cards/tooltips) | https://claude.ai/code/artifact/0436daed-dcdb-4cf0-aa73-b68227fdb0a7 |
| C — Glassy Immersive (glass panels, ambient element glows, hover lift) | https://claude.ai/code/artifact/f531608a-32e8-4815-a99c-4d1b06787d5e |

Owner picked C as best of the three, then rejected the round as too timid:
"still feels incredibly similar… I don't love the grid cards of active skills."
**Kept from C:** hover micro-interactions (lift + border/color glow — "go a long
way to making the site feel more pleasing to use") and the tooltip framed as one
cohesive bordered unit (item art + popup together), not "a div z-indexed over
everything."

### Round 2 — Codex re-imaginings (new information architecture)

Authored by Codex CLI (gpt-5.x-codex, session `019f7241-824d-71c1-999a-fe7d8362bb62`);
QA'd headless (no external refs, no console errors, no h-scroll at 1440/390px,
fidelity zone intact):

| Concept | Artifact |
|---|---|
| **📜 The Exile's Ledger** — dense master–detail: scannable gem table (icon/name/tags/attr color-coding, live filter chips, `/` search) + persistent inspection pane rendering the selected gem's plain-language effect and the faithful popup | https://claude.ai/code/artifact/c8598e13-8589-4c2c-aa89-bd7bc37efe30 |
| **🧭 Atlas of Intent** — goal-first: intent tiles ("Hit something / Cast & control / …") → horizontal discovery lanes → bottom study drawer; ⌘K command palette | https://claude.ai/code/artifact/dd7f35df-93c1-4392-b069-82519797e8e5 |

## Decision (owner, 2026-07-17)

- **The Exile's Ledger wins as the direction.** "Precisely the kind of
  reimagining I was thinking… unopinionated information, driven by the data."
  Not everything about it is liked — it's a *direction*, not a final design.
- Atlas of Intent: liked, but "a little *too* hand-holdy and curated."
- Direction proven ≠ exploration done: owner wants to **continue evaluating
  other possibilities** beyond strict in-game looks for the exploration zone.

## Where the mockup sources live

Self-contained HTML sources were built in a session scratchpad (temp, may be
gone): `sample.html` (real gems-page snapshot, all assets as data: URIs, plus
`assemble.js` to regenerate from a running server), `variant-{classic,modern,glassy}.html`,
`codex-concept-{1,2}.html` (+ `clean-` artifact-ready versions). The artifacts
above are the durable copies. To regenerate a sample base: boot the app, capture
`/gems` + one unique/base card fragment, inline CSS/fonts/images as data: URIs.

## Builds page (decided 2026-07-22)

The Build Planner editor got its own exploration round (owner: current page
"looks like a 3rd grader's attempt", PoE2 artwork doesn't jive with the site
outside the passive tree and tooltips). Five mockups produced — 2 by Claude,
3 by Codex; both "dossier" concepts converged independently.

- **Winner: Concept B "The Dossier"** (Claude) — scrolling four-chapter sheet
  (Gear / Skills / Passive Tree / Notes), sticky section rail, share link
  front-and-center. Artifacts: Claude A ⚔️ 32ae2163, **B 📜 c43f47d1 (winner)**;
  Codex 1 🗺️ ac867b37, 2 🗂️ 2e0e9809, 3 📖 f75161bb.
- **Owner amendments:** gear keeps the in-game *spatial arrangement* (weapons
  at the shoulders, helmet top-center, amulet right of the helmet/body seam,
  rings at body mid-line, gloves/boots bottom-aligned with belt, flasks under
  gloves/boots, charm centered) but drops all in-game artwork; skills lose the
  level control and render real gem icons with hover tooltips; granted-by
  callout kept; `description` added at top, notes stay at bottom.
- Implemented 2026-07-22 on `planner/phase-4a-builds-pages` —
  plan: `docs/superpowers/plans/2026-07-22-builds-dossier-redesign.md`.

## Next steps when resumed

1. Optionally another exploration round riffing on the Ledger (variations on
   density, the inspection pane, glassy hover/tooltip treatment layered on).
2. Lock the target design; write the implementation spec:
   token-first CSS consolidation (fix the hardcoded-literal debt) → shell/nav →
   /gems as Ledger master–detail → propagate structure to uniques/bases →
   detail pages. Passive tree fenced throughout.
3. Implementation was planned to go to Codex CLI in slices, with tests +
   `npm run build:static` + screenshot verification per slice.
