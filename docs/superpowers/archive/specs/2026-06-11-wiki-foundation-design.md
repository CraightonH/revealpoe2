# Wiki Foundation Design

**Date:** 2026-06-11
**Status:** Approved

## Goal

A modern, beginner-friendly Path of Exile 2 wiki. Surfaces data relationships (e.g. which support gems work with a skill) without requiring prior game knowledge. The opposite of poe2db.tw in terms of approachability, but drawing on their rendering approach for accuracy.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js |
| Server | Express |
| Templates | Nunjucks |
| Interactivity | HTMX (search, hover popovers, filters) |
| CSS | Vanilla CSS with custom properties |
| Data | JSON files read from `$POE2DATADIR` at request time |

No frontend build step to start. Vite can be added later if needed (passive tree, etc.).

---

## Color System

All colors derived from in-game vocabulary — players already know what they mean.

### CSS Custom Properties

```css
:root {
  /* Item rarity */
  --color-normal:   #c8c8c8;
  --color-magic:    #8888ff;
  --color-rare:     #ffff77;
  --color-unique:   #af6025;

  /* Gem attribute */
  --color-gem:      #1ba29b;   /* generic gem name color */
  --color-gem-r:    #c44040;   /* Strength */
  --color-gem-g:    #4aad4a;   /* Dexterity */
  --color-gem-b:    #6666aa;   /* Intelligence */
  --color-gem-w:    #aaaaaa;   /* General */

  /* Damage types */
  --color-fire:      #960000;
  --color-cold:      #366492;
  --color-lightning: #ffd700;
  --color-chaos:     #d02090;

  /* UI */
  --color-prop:     #6e9a97;   /* property labels */
  --color-default:  #7f7f7f;
  --color-crafted:  #b4b4ff;
}
```

### Theming

Game colors are **immutable** — they never change between themes. Only surface/background tokens change:

```css
:root[data-theme="dark"] {
  --bg-base:    #0d0d0d;
  --bg-surface: #16181f;
  --border:     #2a2d3d;
}

:root[data-theme="light"] {
  --bg-base:    #f8f6f0;
  --bg-surface: #eeebe3;
  --border:     #ccc8bb;
}
```

---

## Fonts

Served from GGG's own CDN — publicly accessible, no self-hosting needed:

```css
@font-face {
  font-family: 'FontinSmallCaps';
  src: url('https://web.poecdn.com/font/fontin-smallcaps-webfont.woff') format('woff');
}
@font-face {
  font-family: 'FontinRegular';
  src: url('https://web.poecdn.com/font/fontin-regular-webfont.woff') format('woff');
}
@font-face {
  font-family: 'OptimusPrincepsSemiBold';
  src: url('https://web.poecdn.com/font/OptimusPrincepsSemiBold.ttf') format('truetype');
}
```

---

## Image Assets

| Asset type | Source | Path pattern |
|------------|--------|--------------|
| Unique item icons | `image.ggpk.exposed` | `Art/2DItems/.../{name}.dds?format=webp` |
| Skill gem icons (leadSkillIcon) | `image.ggpk.exposed` | `Art/2DArt/SkillIcons/4k/{id}.dds?format=webp` |
| Gem item image | `image.ggpk.exposed` | `Art/2DItems/Gems/New/{id}SkillGem.dds?format=webp` |
| Gem hover background | `image.ggpk.exposed` | `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SmartHover/GemHoverImage{id}.dds?format=webp` |
| Gem header banner | `image.ggpk.exposed` | `Art/Textures/Interface/2D/2DArt/UIImages/InGame/SmartHover/GemHoverTitle.dds?format=webp` |

**Fallback strategy:** All images use the placeholder pattern (deterministic color from gem attribute + initials) with the real image lazy-loaded via `onerror` removal. See `docs/image-assets.md`.

**Production note:** Mirror `GemHoverImage*` and gem icons locally during data scrape — `ggpk.exposed` has intermittent 500s on these paths.

---

## Skill Gem Card Component

Reference implementation: `docs/ui/skill-gem-card.html`

### Structure

```
┌─────────────────────────────────────┐  ← border: 1px, attr color + glow
│ [GemHoverTitle banner]              │
│  [skill icon]  Name          [gem]  │  ← header: 54px, leadSkillIcon absolute
│                Type line           │
├─────────────────────────────────────┤
│  Tags, Tier, Level, Reservation     │  ← .property  color: #6e9a97
│  Requires: ...                      │  ← .requirements
│ ·············separator············· │  ← radial gradient, attr color, 33%
│    Description text (italic)        │  ← .secDescrText  #baad85 FontinRegular
│ ┌──────── Section Name ───────────┐ │  ← .hybridHeader gradient pill
│   Explicit mod text               │  ← .explicitMod  #8888ff centered
│   Mod value highlighted           │  ← .mod-value  white
│ ┌──────── Section Name ───────────┐ │
│   ...                             │
│ ─────────────────────────────────── │
│  Skills can be managed in...       │  ← .default.fst-italic  #7f7f7f
└─────────────────────────────────────┘
```

### Border color by gem attribute

| Gem color | Border | Glow |
|-----------|--------|------|
| `r` (Strength) | `rgba(139,48,48,0.7)` | `0 0 18px rgba(139,48,48,0.45)` |
| `g` (Dexterity) | `rgba(48,100,48,0.7)` | `0 0 18px rgba(48,100,48,0.45)` |
| `b` (Intelligence) | `rgba(48,48,139,0.7)` | `0 0 18px rgba(48,48,139,0.45)` |
| `w` (General) | `rgba(100,100,100,0.7)` | `0 0 18px rgba(100,100,100,0.45)` |

### Separator

Pure CSS — no image asset:
```css
background: radial-gradient(ellipse at center, #6e9a97 0%, #6e9a97 10%, transparent 33%);
background-size: 100% 1px;
background-repeat: no-repeat;
background-position: center;
height: 8px;
```

---

## Routing (Initial)

| Route | Description |
|-------|-------------|
| `GET /` | Homepage — search + featured content |
| `GET /gem/:slug` | Skill gem detail page |
| `GET /item/:slug` | Base item detail page |
| `GET /unique/:slug` | Unique item detail page |
| `GET /search?q=` | HTMX search results fragment |
| `GET /api/gem/:slug` | JSON data endpoint (optional) |

---

## Data Access Layer

A thin module (`src/data/index.js`) exposing typed query functions over the JSON files. Raw JSON access is never done outside this module.

```js
// Examples
getGem(slug)              // by display_name slug
getGemsWithTag(tag)       // filtered by gem_tags
getRecommendedSupports(gem) // resolves recommended_supports[] keys
getBaseItem(id)           // by Metadata/Items/... key
getUniquesBySlot(slot)    // from pob-uniques/
translateStats(statIds)   // stat ids → display text via stat_translations/
```

Data files are loaded once at server start and cached in memory — the full dataset is ~250MB on disk but the in-memory footprint of parsed JSON will be much smaller for the files actually loaded.

---

## What's Not Designed Yet

- Homepage layout
- Search UI and index structure
- Item card component (non-gem)
- Unique item card component
- Navigation / site chrome
- Passive tree (deferred — needs its own design)
