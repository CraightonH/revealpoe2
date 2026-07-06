# Phase 3 — In-Game UI Art Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find and self-host the real Path of Exile 2 in-game UI textures for the Skill Gems menu and Inventory paper-doll so Phase 4 can style the build editor with genuine art, and produce a catalog mapping every planned Phase-4 visual element to an asset (or an explicit CSS-recreation fallback).

**Architecture:** The existing image pipeline is the whole mechanism — a `url(/static/img/<path>.webp)` reference in any `public/css/*.css` file is the ingestion trigger. `scripts/fetch-images.js` (`ddsFromCss`) reverse-maps that back to `<path>.dds`, fetches `https://image.ggpk.exposed/poe2/<path>.dds?format=webp`, and mirrors it to `public/img/<path>.webp`. This phase adds one new CSS file (`public/css/planner-art.css`) whose `url()` refs name the chosen assets, plus a catalog doc. **No changes to `fetch-images.js` are needed** — every chosen asset is a standalone (non-atlas) texture that already converts to webp (confirmed during the spike), so no crop step is required.

**Tech Stack:** Node ESM, `node --test`, the existing `scripts/fetch-images.js` pipeline, plain CSS.

## Global Constraints

- **Self-hosted only, no hotlinking.** Every art reference resolves to `/static/img/<path>.webp` (same-origin); nothing points at `image.ggpk.exposed`, `poe2db`, or any third-party host at runtime. (Images policy in CLAUDE.md → **Icons**.)
- **Never edit `data/source/`.** N/A here (no source data touched), but the provenance policy holds: art is mirrored, not committed (`public/img/` is gitignored).
- **Asset path root** matches existing convention exactly: `Art/Textures/Interface/2D/2DArt/UIImages/InGame/<Subdir>/<file>.dds`. Subdir names use CamelCase to match existing `SmartHover`/`InGame`; **filenames are lowercase** (their real casing in the GGPK). The CDN is case-insensitive, and the on-disk path is self-consistent with the CSS ref, so this is safe.
- **`build:images` is network + rate-limited** (one person's free Cloudflare Worker, concurrency 8). Run it with the CA bundle unset — always via `npm run build:images` (the script already does `env -u SSL_CERT_FILE -u NODE_EXTRA_CA_CERTS`). Never probe the CDN with `curl` (corporate `SSL_CERT_FILE` breaks TLS); use Node `fetch` with those vars unset.
- **`npm test` must stay green and network-free.** `pretest` runs `build:graph` + `build:passives` only — **not** `build:images`. Any guard test added this phase must read only committed files (CSS + catalog doc); it must NOT assert on-disk presence of fetched webp (those aren't present in a fresh CI checkout).
- Nothing ships user-facing this phase (no planner pages exist until Phase 4). `planner-art.css` is created but not linked from any template yet — `fetch-images.js` scans it on disk regardless, which is all that's needed for ingestion.

---

## Spike findings (already completed — do not re-discover, only verify)

The research spike is done. These facts are confirmed by live probing and are the basis for the tasks below:

- **Enumeration API (VueFinder JSON):** `https://ggpk.exposed/files?q=index&adapter=poe2&path=poe2://<lowercase-path>` returns `{files:[{path,basename,type}]}`. All paths/basenames come back lowercase. Use this to list directory contents deterministically instead of guessing filenames.
- **Webp fetch/probe:** `https://image.ggpk.exposed/poe2/<path>.dds?format=webp` → `200 image/webp` for a real, convertible asset; `500 text/plain` for missing **or** unconvertible (ambiguous — that's why enumeration via the API, not guessing, is required). Known-good baseline: `.../SmartHover/GemHoverTitle.dds` → 200.
- **Relevant in-game directories** under `.../UIImages/InGame/` (all standalone `.dds`, no atlas):
  - **`SkillPanel/`** (114 dds) — the Skill Gems menu. Fidelity-critical assets confirmed webp-fetchable: panel background `skillgempanelbg.dds` (+ `skillgempanelbgtop/bottom/fill.dds`), frame `skillpanelframe.dds`/`skillpanelframe2.dds`, gem-icon frame `skillpanelskilliconframe.dds`, **support socket rings** `skillssocketempty.dds` + `skillssocket{blue,green,red,white}.dds` (+ dual-color `skillssocket{bluegreen,greenred,redblue}.dds`, aura `skillssocketaura.dds`, glow `skillssocketglow.dds`), collapse/expand chevrons `skillpanel{collapse,expand}{default,gem,item,granted,ascendancy,sockets}.dds`, level readout bg `skillpanelamountbg.dds`, exp bar `skillpanelexpbar.dds`/`skillpanelexpbarfill.dds`, per-slot silhouettes `itemslot{amulet,belt,body,boots,gloves,helmet,ring,weapon}.dds`.
  - **`InventoryPanel/`** (47 dds) — the paper-doll. Confirmed: slot well `inventorysquare.dds`, area frame `inventoryareaframe.dds`, upper bg `inventorypanelupperbackground.dds`, `panelbottom.dds`, ring slot `inventorypanelringslot.dds`, charm slots `inventorypanelcharmslots3x1.dds`/`3x2.dds`, potion slots `inventorypanelpotion{life,mana}{left,right}.dds`, `potionsareaframe.dds`.
  - **`BuildPlanner/`** (10 dds) — an in-game build-planner panel: `plannerbgexpanded.dds`, `plannerbgcollapsed.dds`, `plannerbutton{regular,hover,pressed}.dds`, `plannernodeoverlay{small,medium,large}.dds`, `iconplannerblue.dds`. On-theme; catalog as optional/decorative chrome.
  - **`CharacterPanel/`** (18 dds) — stat readout chrome: `characterpanelframe.dds`, `mainstat{health,mana,energyshield}.dds`, resist icons `icon{fire,cold,lightning,chaos}.dds`, etc. Useful later for the light-math readout (Phase 7); catalog as reference.
  - Each dir also has a `4k/` subdir (higher-res variants) — **use the standard, non-4k assets**; note the 4k availability in the catalog.
- Confirmed webp-fetchable (200) during the spike: `SkillPanel/skillgempanelbg`, `skillpanelframe`, `skillpanelskilliconframe`, `skillssocketempty`, `skillssocketblue`, `skillssocketglow`, `skillpanelexpandgem`, `skillpanelamountbg`, `itemslothelmet`; `InventoryPanel/inventorysquare`, `inventoryareaframe`, `inventorypanelringslot`; `BuildPlanner/plannerbgexpanded`; `CharacterPanel/characterpanelframe`.

### File Structure

- **Create** `docs/ui/ingame-art-inventory.md` — the catalog: asset path → what it is → which Phase-4 component uses it → standalone/atlas → real-art-or-fallback → licensing note. (New `docs/ui/` directory.)
- **Create** `public/css/planner-art.css` — skeleton stylesheet: class names for each planner component with `url(/static/img/Art/.../<file>.webp)` refs to the confirmed assets, and commented CSS-recreation fallbacks for elements with no usable texture. Not linked from any template this phase.
- **Create** `test/plannerArt.test.js` — CI-safe guard: every `/static/img/...webp` ref in `planner-art.css` is self-hosted (no external host) and its `.dds` is enumerated in the catalog doc (keeps CSS ↔ catalog in sync; catches drift + hotlinking).
- **Modify** none. No `fetch-images.js` change (all assets standalone). No template wiring (no planner pages yet).

---

## Task 1: Spike verification + catalog doc

**Files:**
- Create: `docs/ui/ingame-art-inventory.md`
- (scratch, not committed) an enumeration/probe script under the session scratchpad

**Interfaces:**
- Produces: the authoritative asset list that Task 2's `planner-art.css` `url()` refs and Task 3's guard test both draw from. Every `.dds` path referenced in `planner-art.css` MUST appear as a row in this doc.

- [ ] **Step 1: Enumerate the candidate directories via the VueFinder API**

Write a scratch Node script (e.g. `scratchpad/enumerate.mjs`) that lists each relevant subdir and, for a chosen candidate set, probes webp-convertibility. Run with the CA vars unset. Enumerate at least `skillpanel`, `inventorypanel`, `buildplanner`, `characterpanel` under `art/textures/interface/2d/2dart/uiimages/ingame/`.

```js
// scratchpad/enumerate.mjs
const API = 'https://ggpk.exposed/files';
const CDN = 'https://image.ggpk.exposed/poe2';
const UA  = 'revealpoe2-image-sync/1.0';
const ROOT = 'Art/Textures/Interface/2D/2DArt/UIImages/InGame'; // CDN casing convention
async function ls(lowerPath) {
  const u = `${API}?q=index&adapter=poe2&path=${encodeURIComponent('poe2://' + lowerPath)}`;
  const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const j = await r.json();
  return j.files.filter(f => f.type !== 'dir' && f.basename.endsWith('.dds')).map(f => f.basename);
}
async function webpOk(rel) {
  const r = await fetch(`${CDN}/${rel}?format=webp`, { headers: { 'User-Agent': UA } });
  return r.status === 200;
}
const base = 'art/textures/interface/2d/2dart/uiimages/ingame/';
for (const sub of ['skillpanel', 'inventorypanel', 'buildplanner', 'characterpanel']) {
  const files = await ls(base + sub);
  console.log(`\n### ${sub} (${files.length})`);
  for (const f of files) console.log('  ', f);
}
```

- [ ] **Step 2: Run enumeration + confirm the chosen assets convert to webp**

Run: `env -u SSL_CERT_FILE -u NODE_EXTRA_CA_CERTS node scratchpad/enumerate.mjs`
Expected: full lowercase filename listings per subdir. Then extend the script to `webpOk()` each asset you intend to reference and confirm `200` (not `500`). Any asset that 500s → mark it a CSS-recreation fallback in the catalog instead of referencing it.

- [ ] **Step 3: Write the catalog doc**

Create `docs/ui/ingame-art-inventory.md` with a header (purpose, source = same GGG-asset basis as all existing art per NOTICES.md, licensing note: fan-content fair use, self-hosted not hotlinked) and one table **per planned Phase-4 component group**. Each row: **Asset path** (full `Art/Textures/Interface/2D/2DArt/UIImages/InGame/<Subdir>/<file>.dds`) · **What it is** · **Phase-4 component** · **Standalone/Atlas** (all `Standalone`) · **Real art / Fallback** · **4k variant?**. Cover, at minimum, every asset referenced by `planner-art.css` in Task 2, plus a "Fallback (CSS recreation)" section listing elements with no usable texture (e.g. statue backdrops — decorative, omit/approximate per spec). End with a "How to extend" note: add a `url()` ref in `planner-art.css` + a row here, then `npm run build:images`.

- [ ] **Step 4: Commit**

```bash
git add docs/ui/ingame-art-inventory.md
git commit -m "docs(ui): catalog in-game UI art for the build planner (Phase 3)"
```

---

## Task 2: `planner-art.css` skeleton with confirmed asset refs

**Files:**
- Create: `public/css/planner-art.css`

**Interfaces:**
- Consumes: the asset list confirmed in Task 1 (every `url()` `.dds` here must be a catalog row).
- Produces: the set of `/static/img/...webp` refs that (a) `fetch-images.js` `ddsFromCss` will mirror on the next `build:images`, and (b) Task 3's guard test validates.

- [ ] **Step 1: Write the skeleton stylesheet**

Create `public/css/planner-art.css`. Each planner component gets a class with a `background`/`background-image` `url(/static/img/Art/Textures/Interface/2D/2DArt/UIImages/InGame/<Subdir>/<file>.webp)` ref to a Task-1-confirmed asset. Keep it a skeleton (positioning/sizing is Phase 4's job) but the `url()` refs must be real and complete — they are the ingestion trigger. Include a top comment explaining the file is planner-only, not yet linked from any template, and that Phase 4 fleshes out layout. Reference, at minimum: skill-panel background + frame, gem-icon frame, the support socket rings (empty + each color), collapse/expand chevron, level bg; inventory slot well, area frame, ring/charm/potion slots, per-slot silhouettes. Put CSS-recreation fallbacks (statue backdrops etc.) as commented placeholders with a gradient sketch, per the `gem-card.css` unique-header precedent.

Example shape (fill in the full set):

```css
/* planner-art.css — in-game UI textures for the Build Planner (Phase 3 ingestion).
   Loaded only by planner pages (wired up in Phase 4); the url() refs below are the
   trigger that makes scripts/fetch-images.js self-host these assets into public/img/.
   Catalog: docs/ui/ingame-art-inventory.md. */
:root {
  --planner-art: /static/img/Art/Textures/Interface/2D/2DArt/UIImages/InGame;
}
.planner-skill-panel {
  background: url(/static/img/Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillgempanelbg.webp) top left no-repeat;
}
.planner-skill-frame {
  border-image: url(/static/img/Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillpanelframe.webp);
}
.planner-gem-icon-frame {
  background: url(/static/img/Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillpanelskilliconframe.webp) center / contain no-repeat;
}
.planner-support-socket--empty {
  background: url(/static/img/Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillssocketempty.webp) center / contain no-repeat;
}
.planner-support-socket--blue  { background-image: url(/static/img/Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillssocketblue.webp); }
.planner-support-socket--green { background-image: url(/static/img/Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillssocketgreen.webp); }
.planner-support-socket--red   { background-image: url(/static/img/Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillssocketred.webp); }
.planner-support-socket--white { background-image: url(/static/img/Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/skillssocketwhite.webp); }
/* inventory paper-doll */
.planner-slot-well { background: url(/static/img/Art/Textures/Interface/2D/2DArt/UIImages/InGame/InventoryPanel/inventorysquare.webp) center / cover no-repeat; }
/* ... helmet/body/gloves/boots/belt/amulet/ring silhouettes via itemslot*.webp ... */
/* FALLBACK (no texture): paper-doll king/queen statue backdrops — decorative, CSS gradient approximation in Phase 4. */
```

- [ ] **Step 2: Sanity-check the refs parse and match the catalog**

Run: `node -e "const s=require('fs').readFileSync('public/css/planner-art.css','utf8'); const m=[...s.matchAll(/\/static\/img\/([^)?\"'\s]+)\.webp/g)].map(x=>x[1]); console.log(m.length,'refs'); console.log([...new Set(m)].join('\n'))"`
Expected: prints the deduped list of referenced paths; eyeball that each corresponds to a catalog row from Task 1.

- [ ] **Step 3: Commit**

```bash
git add public/css/planner-art.css
git commit -m "feat(planner): planner-art.css skeleton referencing in-game UI textures (Phase 3)"
```

---

## Task 3: Guard test + ingestion verification

**Files:**
- Create: `test/plannerArt.test.js`

**Interfaces:**
- Consumes: `public/css/planner-art.css` (Task 2) + `docs/ui/ingame-art-inventory.md` (Task 1).

- [ ] **Step 1: Write the failing guard test**

Create `test/plannerArt.test.js`. It must be network-free and read only committed files (CI has no fetched webp). It asserts: (1) every art ref in `planner-art.css` is self-hosted `/static/img/...webp` (no `http(s)://` external host → no hotlinking); (2) every referenced `.dds` (reverse-mapped from the webp ref) appears verbatim in the catalog doc (CSS ↔ catalog sync / drift guard); (3) there is at least one ref (skeleton isn't empty).

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'public/css/planner-art.css'), 'utf8');
const catalog = fs.readFileSync(path.join(root, 'docs/ui/ingame-art-inventory.md'), 'utf8');
const refs = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/["']/g, '').trim());
const imgRefs = refs.filter((r) => r.includes('/static/img/'));

test('planner-art.css references at least one in-game asset', () => {
  assert.ok(imgRefs.length > 0, 'skeleton must reference real assets (the ingestion trigger)');
});

test('every planner-art.css asset is self-hosted (no hotlinking)', () => {
  for (const r of refs) {
    assert.ok(!/^https?:\/\//i.test(r), `external art ref not allowed: ${r}`);
  }
  for (const r of imgRefs) {
    assert.ok(r.startsWith('/static/img/'), `must be same-origin /static/img: ${r}`);
  }
});

test('every planner-art.css asset is documented in the catalog', () => {
  for (const r of imgRefs) {
    const dds = r.replace(/^\/static\/img\//, '').replace(/\.webp$/i, '.dds');
    assert.ok(catalog.includes(dds), `undocumented asset (add a row to docs/ui/ingame-art-inventory.md): ${dds}`);
  }
});
```

- [ ] **Step 2: Run the test to verify it passes against Tasks 1–2**

Run: `node --test test/plannerArt.test.js`
Expected: PASS (all three). If "undocumented asset" fails, the catalog is missing a row for a CSS ref — fix the catalog (or the ref). This is the intended CSS↔catalog coupling.

- [ ] **Step 3: Run the full suite to confirm nothing regressed**

Run: `npm test 2>&1 | tail -15`
Expected: all tests pass (the new file included), no network access.

- [ ] **Step 4: Verify real ingestion via `build:images` (network; the acceptance criterion)**

Run: `npm run build:images 2>&1 | tail -5`
Expected: the summary line reports the new SkillPanel/InventoryPanel/etc. files under `added` (first run) and the referenced count grows by the number of new assets. Confirm the files landed:

Run: `ls public/img/Art/Textures/Interface/2D/2DArt/UIImages/InGame/SkillPanel/ | head`
Expected: `skillgempanelbg.webp`, `skillssocketempty.webp`, … present.

- [ ] **Step 5: Verify idempotency (two-tier gate holds)**

Run: `npm run build:images 2>&1 | tail -3`
Expected: `unchanged (graph + files on disk), skipped network sync` — a no-op second run (referenced set byte-identical, all files present). Confirms orphan-pruning and the gate are unaffected.

- [ ] **Step 6: Commit**

```bash
git add test/plannerArt.test.js
git commit -m "test(planner): guard planner-art.css refs are self-hosted and cataloged (Phase 3)"
```

---

## Final: roadmap checklist (orchestrator, after Task 3)

- [ ] Tick `- [x] Phase 3 — In-game UI art ingestion` in `docs/superpowers/specs/2026-07-06-build-planner-roadmap.md` status checklist, noting the completing commit, and commit that change (protocol step 5). **Note:** the roadmap file also lives in the main checkout / other worktrees; only touch the status line for Phase 3 to avoid clobbering parallel phases' updates.

## Self-Review

- **Spec coverage:** catalog doc (AC-1) → Task 1. Assets fetch via `build:images`, idempotent, prune unaffected (AC-2) → Task 3 Steps 4–5. Visual check acceptable via CSS + assets, nothing user-facing (AC-3) → satisfied (no template wiring; `planner-art.css` unlinked). No hotlinking (AC-4) → Task 3 Step 1 guard + Global Constraints. Atlas crop only if needed → not needed (all standalone, confirmed) → no `fetch-images.js` change. Fallback policy → catalog "Fallback" section + commented CSS sketches (Task 1 Step 3, Task 2 Step 1).
- **Placeholder scan:** none — asset paths, API, commands, and test code are concrete.
- **Type consistency:** the reverse-map (`/static/img/<X>.webp` ↔ `<X>.dds`) is used identically in `fetch-images.js` `ddsFromCss`, the catalog rows, and the guard test.
