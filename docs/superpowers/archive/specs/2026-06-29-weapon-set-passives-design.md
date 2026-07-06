# Weapon-set passive skills — design

## Goal

Model Path of Exile 2's **Weapon Set Passive Skills** in the interactive tree.
These are 25 *extra* passive points, separate from the 122 main pool, that are
allocated independently for each of the two weapon sets. Swapping weapons swaps
which set's allocation is live, so a player can specialize each weapon set
differently (e.g. Set I = 25 points into crit, Set II = 25 points into AoE) over
a shared main-tree backbone.

## Mechanics (the rules we implement)

- **Two extra pools of 25**, one per weapon set. The 25 points are the *same
  earned pool* reused per set: Set I may allocate up to 25 weapon-set nodes AND
  Set II may independently allocate up to 25. (Not a single 25 split between
  them.) Total weapon-set node allocations possible: up to 50.
- **Must root in the shared tree.** A Set-_k_ weapon node must be adjacent to
  `allocated (main) ∪ starts ∪ wsAlloc[k]`. It can chain within its own set, but
  **never through the other set** — "Set II can't extend off Set I, and vice
  versa." Both sets branch off the shared main tree.
- **Independent budgets:** main 122, Set I 25, Set II 25, ascendancy 8 — each
  enforced separately.
- **Cascade:** deallocating a shared/main node that a weapon node depended on for
  connectivity orphans that weapon node, which is then pruned from *both* ws
  layers (same reachability rule as the main tree, per set).

## Data model — three allocation layers

Replaces the inert mask-map scaffolding (`weaponState` 1/2/3 + `toggleSet` /
`setMask`), which can't express the per-set connectivity rule (a single
`allocated` set lets a BFS reach Set II through Set I).

| Layer | Pool | Active when |
|---|---|---|
| `allocated` | main 122 | always |
| `wsAlloc[1]` | Set I 25 | weapon set I equipped |
| `wsAlloc[2]` | Set II 25 | weapon set II equipped |

A node is in at most one layer. A node allocated as *shared* is never also a
weapon-set node; conversely Set I and Set II may each independently include the
same node hash (each spends one of its own 25) — they are separate Sets.

## Editing model — two toggle buttons

The controls bar's existing "Weapon Set" row (currently disabled `I`/`II`
buttons + "soon") becomes live. State `wsMode ∈ {null, 1, 2}`:

- **Default (`null`)** — no button active, no special label. Clicks
  allocate/deallocate **main** nodes exactly as today. Weapon-set nodes are
  **hidden**.
- **Set I active (`1`)** — `I` button glows **red**. The shared main tree is
  drawn normally (it's live in Set I); clicking an unallocated reachable node
  spends a **Set I** weapon point; Set II's nodes are hidden. Set I connectors +
  node rings render **red**.
- **Set II active (`2`)** — `II` button glows **green**; symmetric, **green**.

Clicking the active set's button again returns to default. Only one set active
at a time. Switching sets is non-destructive (each layer persists).

Path-preview + one-click path allocation (`passive-path.js`) operate within the
active mode: in Set-_k_ mode the source frontier is `allocated ∪ starts ∪
wsAlloc[k]`, the cost is checked against that set's 25-pool, and the preview is
stroked in the set color (red / green) instead of the default white-gold.

## Budget enforcement

Extend the existing `canAfford` pattern. Budgets come from build meta:
`{ pointBudget:122, ascendancyBudget:8, weaponSetBudget:25 }`. The active pool
for a click is chosen by `wsMode`: main/ascendancy when `null`, else the
`wsAlloc[wsMode]` count vs `weaponSetBudget`. Weapon nodes never consume the main
or ascendancy pools.

**Counter** (`#tree-points`): `Passives N / 122 · I a / 25 · II b / 25 · Asc c / 8`.
The `points-full` red flag trips when *any* pool relevant to the current mode is
maxed.

## Rendering

- `drawNodes`: a weapon-set node (in `wsAlloc[k]`) draws its frame as allocated
  and gets a colored ring in the set color. Visibility: hidden in default mode;
  in Set-_k_ mode only set _k_'s nodes show (plus the always-visible shared tree).
- `drawEdges`: connectors between two same-set weapon nodes — and the entry edge
  from the shared frontier to a set's first node — stroke in the set color
  (`WS_COLOR[1]` red, `WS_COLOR[2]` green) over the normal bronze main connectors.
- Hit-testing honors the same per-mode visibility so you can't click a hidden
  set's node.

## Pure / tested logic (`public/js/passive-alloc.js`)

All new rules are pure and node-tested (`test/passiveAlloc.test.js`), matching
the project's pure-module convention:

- `wsCanAllocate(adj, mainAllocated, starts, wsSet, hash)` — adjacency to
  `mainAllocated ∪ starts ∪ wsSet`, node not already in `wsSet`.
- `wsDeallocate(adj, mainAllocated, starts, wsSet, hash)` — remove + reachability
  prune within the set (anchored to `mainAllocated ∪ starts`).
- `pruneWeaponSets(adj, mainAllocated, starts, wsSet)` — re-anchor a ws layer
  after the main tree shrinks (drop nodes no longer reachable). Called for both
  layers on any main-node deallocation.
- `canAfford` — extended so a ws allocation is gated on `weaponSetBudget` against
  the active set's count.

Existing `pointsSpent` continues to report main vs ascendancy from `allocated`;
ws counts come from `wsAlloc[k].size`.

## Share code (v7 codec — already weapon-set-aware)

`passive-code.js` `decode` already returns `weaponSet[]` and per-record
`trailing[].subType` (`0x02` = Set I, `0x03` = Set II). Two changes:

- **Import** (`importFromHash`): route trailing weapon-set records into
  `wsAlloc[1]` / `wsAlloc[2]` by `subType` instead of merging them into
  `allocated` (the current bug — imported weapon nodes inflate the main count and
  ignore the per-set connectivity).
- **Export** (`buildShareCode`): emit a trailing weapon-set record per node in
  each `wsAlloc[k]` with the matching `subType`, so weapon-set builds round-trip.

Class-root detection keeps treating all decoded hashes as part of the build for
the "which class start owns this" BFS (unchanged).

## Out of scope

- Per-node weapon-set data does not exist in GGG source (`ws` flag is 0
  everywhere); any reachable passive can be weapon-set allocated. No build/data
  change beyond the `weaponSetBudget` meta scalar.
- Mastery nodes (still excluded, TODO #7).
- Encoding the generic "+5 to any Attribute" pick (already deferred) is unchanged.

## Testing

- **Pure unit tests** for `wsCanAllocate` / `wsDeallocate` / `pruneWeaponSets` /
  extended `canAfford`: per-set connectivity, no-cross-set reach, cascade from a
  main-node dealloc, 25-pool gating.
- **Full suite** stays green (`npm test`).
- **Manual / live** verification on the dev server: enter Set I, allocate a red
  branch off the main tree; switch to Set II, allocate a green branch; confirm
  budgets, hidden-set behavior, cascade on main dealloc, and share-code
  round-trip.
