# Variant label vs build name (2026-07-26)

Amends Phase 8 of the Build Planner roadmap (`2026-07-06-build-planner-roadmap.md`) and Amendment 2 of `2026-07-21-build-planner-amendments-design.md`. Small, surgical: no schema change, no migration.

## Problem

Phase 8 shipped variants with the label and the build name welded together:

- `addVariant(parentId, label)` sets the child's `name` **to the label**.
- `renameVariant(parentId, buildId, label)` force-writes `child.name = label`.

I did that deliberately ("one thing to edit"), and it is wrong. It collapses two distinct concepts, so a variant reads as *being* its label rather than *being a build that plays a role* in a group. There is no way to have a build titled "Stormweaver CoC" whose role in the group is "Leveling".

## Target model

A variant entry is a **labeled link** to a build. Two independent strings:

| Concept | Field | Example | Scope |
|---|---|---|---|
| Build identity | `build.name` | `Stormweaver CoC` | the build itself, wherever it appears |
| Role in the group | `parent.variants[i].label` | `Leveling` | only meaningful inside the parent's group |

Worked example — one group, four builds, all sharing a title:

```
build title:  Stormweaver CoC
  variant 1 label = Leveling
  variant 2 label = Early mapping
  variant 3 label = Endgame
```

Strip: `[ Stormweaver CoC ] [ Leveling ] [ Early mapping ] [ Endgame ]`

The **parent has no label** — it is the root of its group and is identified by its name. Adding a pseudo-label for it would invent a field the model does not need.

## Data model

**Unchanged.** `variants: [{label, buildId}]` is already the correct shape; only the store's write behavior collapsed it. Schema stays v3, no migration.

## Changes

### Store (`public/js/build-store.js`)

- `addVariant(parentId, label)` — the child inherits the parent's `name` **verbatim** (decision 2026-07-26: truest to "a variant is a duplicate"; the switcher disambiguates by label rather than by mangling names). The label lives only on the parent's entry.
- `renameVariant(parentId, buildId, label)` — updates **only** the entry's label. Drops the `child.name` write entirely.
- Build rename (`update(id, {name})`) already touches only `name`; no change, and it now genuinely diverges from the label.

Consequence, accepted: several builds in a group share one name. That is the point — they are the same build at different phases.

### UI

Each string appears in exactly one place, so it is always clear which one is being edited:

| Surface | Shows | Edited by |
|---|---|---|
| Strip tab (variant) | the **label** | ✎ on the active tab → `renameVariant` |
| Strip tab (parent) | the parent's **name** | — (rename it from the head) |
| Dossier head | the build's own **name** | existing ✎ rename → `update({name})` |
| Switcher row | `name`, plus a muted `· label` when the build is a variant | — |

The switcher qualifier is the only addition beyond decoupling. Without it, four rows read `Stormweaver CoC` with nothing to tell them apart. It reads the label via the existing `parentOf()`.

## Testing

- **Store:** independence in **both** directions — `renameVariant` leaves `build.name` untouched; `update({name})` leaves the label untouched. Plus: `addVariant` copies the parent's name rather than the label.
- **Render:** the variant tab renders the label while the dossier head renders the name (proves they are not the same string); the switcher row shows the label qualifier for a variant and not for a standalone build.
- **Headless:** relabel a tab, confirm the head's title does not move; rename the build, confirm the tab's label does not move.

## Non-goals

- **Attaching an existing build as a variant** — considered and declined 2026-07-26. Would need a picker, cycle prevention, and a rule for a build already parented elsewhere. `＋ Variant` continues to create the child by duplicating.
- Renaming a variant's label from anywhere but its own active tab.
- Any change to the group codec: labels already travel in the v2 envelope (`{l, b}`) and the build's `name` already travels inside the build. Round-tripping two independent strings needs no codec work.
