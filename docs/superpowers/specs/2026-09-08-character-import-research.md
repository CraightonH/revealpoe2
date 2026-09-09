# Character Import ("sync my real character into the planner") — research notes

**Date:** 2026-09-08
**Status:** RESEARCH ONLY — parked as `docs/TODO.md` item 5. No design approved, no code written. Brainstorm stopped after two decisions (below) so the next session can pick up without redoing the investigation.
**Evidence base:** GGG developer docs (authorization, index, reference, changelog, game), live CORS/endpoint probes run 2026-09-08 with Node `fetch` (scripts were throwaway; results tabulated below), a codebase map of the planner (`public/js/build-*.js`, `_headers`, `workers/mcp/`), and the PoB2 import/export docs.

## Goal

Mobalytics-style flow: log in with your Path of Exile account, see your characters, pick one, and it seeds a new build in the planner (`/builds`) with the real class/ascendancy, passives, skill setups, and gear. The user then edits it like any other build. This is the first half of `docs/TODO.md` item 5 (the "design gear to fill the gap" half is a separate, later feature that depends on this one).

## Decisions taken so far (owner-approved in the 2026-09-08 brainstorm)

1. **Requirement is "real character in", not the login UX.** Any route that gets the user's actual character into the planner satisfies the goal. The login flow is desirable, not required.
2. **Build it as a source-agnostic importer with pluggable source adapters.** PoB2 build-code paste is the first adapter. GGG OAuth is a later adapter over the same mapping core. Modular by design so further sources can be added.

## Open question (where the brainstorm stopped)

**How should rare items land?** The v3 store holds `gear[slot] = { item: {kind,slug}, mods: [{affix, tier}] }`. Every source hands us rare mods as *display text* ("+45 to maximum Life"), and reverse-mapping text to an affix family + tier in `public/generated/mod-pools.json` is fuzzy and sometimes ambiguous. Options on the table, none chosen:

- **A.** Best-effort map into `mods[]`; per-item import report lists what didn't resolve. Schema unchanged, light math keeps working. (Recommended by Claude, not yet accepted.)
- **B.** Base only, plus a new raw-item-text field on the gear slot so nothing is lost; math won't see it.
- **C.** Both: map what resolves and keep raw text alongside (schema bump to v4).

Subsequent questions not yet asked: where the import UI lives (a "New build → Import from…" picker vs extending `#/import/<code>`), whether a character-level field is added to the schema, and how partial imports report.

## Finding 1 — the login flow cannot be pure client-side

Three independent blockers; any one is sufficient.

| Blocker | Evidence |
|---|---|
| Token endpoint has no CORS | `OPTIONS https://www.pathofexile.com/oauth/token` → 405, `POST` → 400 `invalid_client`; **neither response carries `Access-Control-Allow-Origin`** (only `Access-Control-Expose-Headers` for rate-limit headers). A browser cannot exchange the auth code for a token. |
| Public clients are desktop-only | GGG authorization docs: public clients "Must only use the Authorization Code (with PKCE) grant type and must use a local redirect URI (ie. http://127.0.0.1:8080/callback)". A web app is therefore a *confidential* client and needs a client secret, which needs server code. |
| Our own CSP forbids it | `_headers:19` ships `connect-src 'self'` and `Cross-Origin-Opener-Policy: same-origin`; the header comment frames "no runtime third-party" as a deliberate invariant. Blocks both a direct call and a popup `window.opener` handshake. Also: browsers cannot set `User-Agent`, and GGG requires `User-Agent: OAuth {clientId}/{version} (contact: {contact})` on OAuth client requests. |

Silver lining, for the record: the **resource API does support CORS**. `OPTIONS https://api.pathofexile.com/character/poe2` with `Origin: https://revealpoe2.com` → 204 with `Access-Control-Allow-Origin: https://revealpoe2.com`, `Access-Control-Allow-Headers: Authorization, Content-Type, User-Agent, X-Data-Language`, `Access-Control-Allow-Credentials: true`. So once a token exists, the browser *could* call the character API directly if CSP were relaxed. Not recommended (see Finding 2), but it's an option.

## Finding 2 — smallest server footprint for OAuth: one Cloudflare Pages Function, not a new Worker

- Lives in the **existing Pages project** (`functions/` dir picked up by `wrangler pages deploy dist`), same origin as the site → `/api/poe/*`. CSP stays `connect-src 'self'`. No new deployable, no new zone, no CORS.
- Four routes: `login` (redirect to `https://www.pathofexile.com/oauth/authorize` with `state` + PKCE), `callback` (code→token at `https://www.pathofexile.com/oauth/token`, using client secret from Pages env), `characters` (`GET https://api.pathofexile.com/character/poe2`), `character/:name` (`GET https://api.pathofexile.com/character/poe2/<name>`). Scope: `account:characters` (add `account:profile` only if we want to show the account name).
- **Stateless:** hold the access token in an encrypted HttpOnly cookie. Confidential-client access tokens last 28 days, refresh tokens 90 days; skip refresh for v1 and just re-login. No KV, no D1, no accounts. This keeps the roadmap's "no backend *storage*" spirit while amending the literal "no backend" non-goal (see Consequences).
- Rate limits: the token endpoint reported policy `token-request-limit` = `60:30:30` per IP (60 hits / 30 s / 30 s lockout). Honour `X-Rate-Limit-*` and `Retry-After`; GGG: "Exceeding these limits frequently will result in your application access being revoked."
- Required disclaimer somewhere visible: "This product isn't affiliated with or endorsed by Grinding Gear Games in any way."
- **Do not** host this in `workers/mcp`: it's cross-origin at `mcp.revealpoe2.com` (would force CORS + CSP relaxation) and TODO item 6 has that worker orphaned pending a keep/kill decision.

## Finding 3 — HARD BLOCKER: GGG is not issuing new OAuth clients

`https://www.pathofexile.com/developer/docs/index` (checked 2026-09-08): **"We are currently unable to process new applications."** Existing apps can be managed via "Manage applications" in the account profile. No timeline, no waitlist. Mobalytics, Maxroll's PoE2Planner and PoB2 all obtained client ids before this.

Consequence: **no OAuth path works for anyone until this changes**, regardless of architecture. Action when picking this up: email `oauth@grindinggear.com` anyway (application, client type = confidential, grant = authorization_code + refresh_token, scope = `account:characters`, purpose, redirect URI `https://revealpoe2.com/api/poe/callback`), and build the non-OAuth adapter first.

## Finding 4 — zero-backend adapter available today: PoB2 build code

Path of Building for PoE2 has its own GGG client and imports the user's character via OAuth (PKCE, local redirect). The user exports a build code and pastes it into Reveal. Fully client-side, no GGG approval needed, no CSP change.

- **Format:** `base64url(deflate(XML))` with `+`→`-`, `/`→`_`. We already ship deflate + base64url in `public/js/build-code.js`.
- **Tree:** `<Spec nodes="…">` is a comma-separated list of allocated node **hashes**. `synthesizeState()` in `public/js/passive-code.js:181` takes allocated hashes and mints a v7 tree code — this is exactly the existing constructor to feed.
- **Skills:** skill groups with gem names, level, quality, enabled state. Map gem name → slug via `search-index.json`. Watch the two disjoint gem id prefixes (`Metadata/Items/Gem/` vs `Gems/`) — never normalize (`src/data/buildExport.js:14-25`).
- **Items:** raw in-game item text (`Rarity:` / name / base / `--------` blocks). **We have no runtime item-text parser** (`scripts/graph/uniques.js:26-45` parses PoB *unique* blocks at build time only). Writing one is the main new work. Uniques resolve by name (`Unique/<Display Name>` is our node key, so this is clean). Rares hit the open question above.
- Limitation: requires the user to have PoB2 installed. Not the login UX, same end state.

## Finding 5 — rejected: legacy no-login `character-window` endpoints

`https://www.pathofexile.com/character-window/get-characters?accountName=…&realm=poe2` is undocumented, sends **no** `Access-Control-Allow-Origin` (so it would still need a proxy), requires the profile to be public, and every probe (browser UA and plain UA, with and without `#1234` discriminator) returned `403 {"error":{"code":6,"message":"Forbidden"}}`. Consistent with a private test profile; a working case was never confirmed. The `api.pathofexile.com` variant is a 404. Not a foundation.

## Finding 6 — rejected: GGG `.build` files as a source

The in-game Build Planner format is **import-only**: the game docs say "Editing or creating builds within Path Of Exile 2 is currently not supported." Items in that format are hints (`unique_name` / `additional_text`), not item objects. Our existing `public/js/build-file.js` export stays one-directional; it is not a sync source. (Fixtures: `test/fixtures/build-files/`.)

## What the GGG character API would give us (for the OAuth adapter, when unblocked)

From `GET /character/poe2/<name>`: `id, name, realm, class, league, level, experience`, `equipment[]` (Items: `inventoryId, typeLine, baseType, name, rarity, implicitMods, explicitMods` — since 3.29.0 these are `ItemMods` objects, not strings — plus `sockets, socketedItems`), `skills[]` (PoE2-only Items = gem tabs), `passives { hashes, hashes_ex, specialisations {set1,set2,set3}, skill_overrides, jewel_data, quest_stats }`. Note the PoE2 character endpoint no longer returns unequipped inventory items.

## Proposed shape (not yet designed in detail)

```
public/js/import/
  core.js          # ExternalCharacter -> v3 build (pure, node-tested)
  item-text.js     # in-game item text -> {kind, slug, mods[]} (pure)
  sources/pob2.js  # build code -> ExternalCharacter
  sources/ggg.js   # (later) /api/poe/character/:name JSON -> ExternalCharacter
functions/api/poe/ # (later) Pages Function: login, callback, characters, character/:name
```

**ExternalCharacter** is the source-agnostic intermediate: `{ class, ascendancy, level, passives: {hashes[], ...}, skills: [{gem, level, supports[]}], items: [{slot, rarity, name, base, mods: [text], ...}] }`. Every adapter produces it; `core.js` alone knows the v3 build schema. Import result is `{ build, report }` where `report` lists unresolved items/gems/nodes so partial imports are honest rather than silent.

## Data-model consequences

- Class/ascendancy, passives (hashes → v7 code), skill setups, and uniques-by-name map cleanly onto v3.
- **Rares are lossy** (open question above).
- **No character level field** in v3 (`level` exists only per skill setup). Either add one or drop it on import.
- `public/generated/passive-build-ids.json` maps hash → PassiveSkills string id; the GGG adapter needs hashes (fine), the `.build` export already uses string ids. PoB2 gives hashes. No reverse map needed for import.
- **Roadmap amendment required for the OAuth adapter:** `2026-07-06-build-planner-roadmap.md` records "no backend, no accounts" as an approved non-goal. A Pages Function with a stateless cookie amends "no backend" while keeping "no storage, no accounts". Record it explicitly when that adapter is designed.
- `_headers` needs no change for PoB2. For the GGG adapter, still no change if everything goes through the same-origin Function.

## Next steps when this is picked up

1. Resume the brainstorm at the open question (rares), then UI placement, then level field.
2. Write the design spec (`docs/superpowers/specs/YYYY-MM-DD-character-import-design.md`) for the importer core + PoB2 adapter; amend the roadmap non-goal only when the GGG adapter is designed.
3. Send the GGG application email in parallel; expect an indefinite wait.
4. Grab a real PoB2 export from the owner's own character as the fixture oracle (same method as `test/fixtures/build-files/`).

## Sources

- https://www.pathofexile.com/developer/docs/authorization (client types, grant rules, token lifetimes)
- https://www.pathofexile.com/developer/docs/index ("unable to process new applications", User-Agent format, rate-limit headers, disclaimer)
- https://www.pathofexile.com/developer/docs/reference (character endpoints and types)
- https://www.pathofexile.com/developer/docs/changelog (`poe2` realm added 0.1.1g; `skills`, `specialisations`, `quest_stats`; ItemMods in 3.29.0)
- https://www.pathofexile.com/developer/docs/game (`.build` format is import-only)
- https://deepwiki.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/5.3-build-importing-and-exporting (PoB2 code format, OAuth import)
- https://maxroll.gg/poe2/news/poe2planner-character-import-feature (comparable product; "you can only import your own characters")
