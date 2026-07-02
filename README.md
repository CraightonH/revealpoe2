# Reveal

A modern, beginner-friendly Path of Exile 2 wiki. The goal is the opposite of
poe2db.tw: surface the *relationships* between game data (which support gems work
with a skill, what a unique's mods actually do, which bases a mod can roll on)
without requiring you to already know them.

Server-rendered with Express + Nunjucks, reading a single pre-compiled property
graph (`build/graph.json`). Production ships as a **static prerender** of that
same app to Cloudflare Pages — no backend at runtime.

> This product isn't affiliated with or endorsed by Grinding Gear Games in any
> way. Path of Exile 2 and all game content are the property of Grinding Gear
> Games. See [`NOTICES.md`](NOTICES.md) and the in-app `/credits` page.

## Prerequisites

- Node.js ≥ 20
- Python 3 (stdlib only) — for the data scraper

## Getting started

Game data is **not** in the repo (`data/source/` is gitignored — large, ~250 MB,
and regenerable). A fresh clone has no data, so the first step is to scrape it:

```bash
npm install
python scripts/scrape.py        # mirror game data into data/source/ (required)
npm run build:images            # one-time: self-host game icons into public/img/
npm run dev                      # http://localhost:3000
```

Without `scrape.py` the graph build has nothing to compile. Without
`build:images` the dev server renders placeholder icons (by design — fine until
you work on icon layout).

## How development works

**Develop on the server; the static build is a release/verification step, not a
second dev surface.** The prerenderer boots this exact Express app and crawls it,
so `localhost` is what gets frozen into `dist/`.

```bash
npm run dev            # inner loop: --watch server, rebuilds graph + client artifacts
npm test               # node:test suite
npm run build:static   # full static build into dist/ (graph → images → index → prerender)
npm run deploy         # build:static + wrangler pages deploy (non-main branch ⇒ preview)
```

After a game patch the whole content-update loop is `python scripts/scrape.py`
→ `npm run deploy`.

The complete lifecycle, the dev/static split, and the data/graph architecture
are documented for both humans and AI assistants in
[`CLAUDE.md`](CLAUDE.md) (start there), with deeper dives in [`docs/`](docs/):

- [`docs/deploy-cloudflare.md`](docs/deploy-cloudflare.md) — static build pipeline, prerender crawler, Pages ops
- [`docs/image-assets.md`](docs/image-assets.md) — self-hosted icons + drift handling
- [`docs/data-source.md`](docs/data-source.md) — scraper and source layout

## Contributing

- Read [`CLAUDE.md`](CLAUDE.md) first — it's the canonical architecture +
  workflow guide, and it covers the **Data Provenance policy** (hand-authored
  game facts go in `data/manual/*.json`, never in `data/source/`).
- Keep `npm test` green; verify static-only behavior (search, theory-crafting,
  any new client-fetched endpoint) against a build or preview, not just unit tests.
- The project is non-commercial; please keep it that way (it's what keeps the
  fan-content use within GGG's tolerance).

## License

Code: [MIT](LICENSE). Game content is GGG's IP, used under fan-content fair use —
see [`NOTICES.md`](NOTICES.md).
