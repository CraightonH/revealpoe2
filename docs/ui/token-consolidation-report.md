# CSS token consolidation report

## Scope and outcome

This refactor makes `public/css/tokens.css` the source for shared thematic colors in the editable CSS and removes static inline color/font declarations from the touched templates. It is value-preserving: every replacement resolves to the exact original color value. No visually similar values were merged.

The two protected `app.css` regions from the task (`HEAD` lines 344–614 and 709–826) remain byte-for-byte unchanged. Their literals are therefore documented as fenced exceptions below, even where a matching reference token now exists.

## Token families added

- Shared neutrals: `--color-black`, `--color-white`.
- Brand and search categories: `--brand-desecrated-*`, `--brand-revealed-*`, `--search-keystone-color`, and `--search-notable-color`.
- Theory Crafting fallbacks: `--theory-bg-surface`, `--theory-border`, `--theory-text-muted`, `--theory-accent`, `--theme-dark-bg-base`, and `--theme-dark-text`.
- Passive/parchment references: `--passive-ui-*` and `--tooltip-*`. These stage exact values for future use; their current consumers are inside the hard fence and were not edited.
- Card fallbacks and shared translucent surfaces: `--card-corrupted-*`, `--card-normal-*`, `--surface-normal-subtle`, `--surface-white-06`, and `--color-gem-tab-transparent`.
- Affix tags: the coherent `--tag-*` family for elements, offense, defences, resources, miscellaneous tags, and the three Desecrated boss sources. The intentionally bright element values remain distinct from the base `--color-fire`, `--color-cold`, `--color-lightning`, and `--color-chaos` values.

The existing `--color-crafted` token was reused for every `#b4b4ff` declaration after exact-value equality was verified.

## Replacement counts

Counts below are color-literal occurrences removed from declarations (comments excluded).

| File | Literals replaced |
| --- | ---: |
| `public/css/app.css` | 32 |
| `public/css/gem-card.css` | 60 |
| `public/css/browse.css` | 15 |
| **Total** | **107** |

Template cleanup did not replace raw color literals; it moved existing inline `var(...)`/font declarations into classes:

- `views/home.njk`: page layout, title font/color, and four link colors.
- `views/macros/nav.njk`: page-title color.
- `views/macros/affix-tables.njk`: affix-heading color.
- `views/macros/base-card.njk`: unique-link color and text decoration.
- `views/macros/gem-card.njk`: comment wording only, removing a stale raw-hex mention.

## Single-use literals left in place

These thematic or functional values occur once outside `tokens.css` and outside the protected regions, so they remain literal under the task rule:

| File | Values | Purpose |
| --- | --- | --- |
| `views/base.njk` | `#0b0c0a` | Browser `theme-color` metadata; CSS custom properties cannot be used in meta content. |
| `public/css/app.css` | `#0c0d0d` | Gem browse title texture fallback. |
| `public/css/app.css` | `#999` | Theory Crafting help-description fallback. |
| `public/css/gem-card.css` | `#0f1515` | Gem-tab gradient endpoint. |
| `public/css/gem-card.css` | `#6fb0c9`, `#c9a24b` | Kalguuran and Ezomyte origin accents. |
| `public/css/gem-card.css` | `#c7c0a5`, `#c8aa6e`, `#c8b78a` | Bonded augment text, instill border fallback, and emotion title. |
| `public/css/gem-card.css` | `#6ea8ff`, `#d75757`, `#b98bff`, `#4fc4c0`, `#9aa7b4` | One-off augment-family accents. |
| `public/css/gem-card.css` | `rgba(136,136,255,0.13)`, `rgba(136,136,255,0.16)`, `rgba(136,136,255,0.2)`, `rgba(139,139,139,0.2)`, `rgba(148,148,168,0.16)` | Distinct magic/card/tag surface treatments. |
| `public/css/gem-card.css` | `rgba(150,130,90,0.35)`, `rgba(200,170,110,0.1)`, `rgba(200,200,200,0.5)` | Instill and augment-family surfaces. |
| `public/css/app.css` | `rgba(27,162,155,0.2)`, `rgba(175,96,37,0.2)`, `rgba(200,180,100,0.2)`, `rgba(200,180,100,0.15)`, `rgba(136,136,255,0.15)` | Search-category backgrounds with intentionally distinct alphas. |
| `public/css/app.css` | `rgba(196,64,64,0.12)`, `rgba(74,173,74,0.12)`, `rgba(102,102,170,0.12)`, `rgba(170,170,170,0.12)` | Attribute filter backgrounds. |
| `public/css/planner-art.css` | `rgba(90,80,60,0.35)`, `rgba(20,18,14,0.55)`, `rgba(200,180,140,0.6)`, `rgba(200,180,140,0.15)` | Single-use artwork overlays; this file was audited but not edited. |

Neutral pure-black/white alpha shadows and overlays remain literal by the task's explicit exception. This includes black alpha values from `0.14` through `0.85` and white alpha values `0.03`, `0.04`, `0.05`, and `0.1` in the audited CSS. Their repetitions are non-thematic shadow/overlay uses, not missed shared-color tokens.

## Protected literals

The protected original `app.css` lines 344–614 and 709–826 contain repeated parchment, weapon-set, black/white, and tooltip values. They were not replaced. Notable fenced values include `#c9aa71`, `#9a8f7a`, `#e8dcc0`, `#181410`, `#e0584e`, `#5bbf6a`, `#ff8a80`, `#9be8a6`, `#fff`, `#000`, `#b7ab83`, `#f0e6d2`, and `#c9a227`. The comment-only `#e7b478` reference is also fenced. Exact parchment/tooltip reference tokens were added without altering those consumers.

## Near-duplicate owner decisions

No values in this table were unified.

| Area | Values kept distinct | Future owner question |
| --- | --- | --- |
| Fire | `--color-fire: #960000` vs `--tag-fire: #e0563c` | Should card element red and bright tag red ever share a palette step? |
| Cold | `--color-cold: #366492` vs `--tag-cold: #5aa6e0` | Same question for blue. |
| Lightning | `--color-lightning: #ffd700` vs `--tag-lightning: #e8c83c` | Same question for yellow. |
| Chaos | `--color-chaos: #d02090` vs `--tag-chaos: #d050b0` | Same question for magenta. |
| Keystone/notable search | `#c8b464`, `#b8a454` vs `--color-notable: #d4a13a` and `--color-keystone: #8888ff` | Search category semantics currently use a separate muted gold pair. |
| Parchment/gold | `#baad85`, `#c9aa71`, `#c8a13a`, `#e8dcc0`, `#b7ab83`, `#c8b888`, `#e6c989` | These are close but serve parchment, passive UI, theory accent, tooltip, theme text, and brand roles. |
| Affix red pair | `--tag-damage: #e06a5a` vs `--tag-life: #e06a6a` | The one-channel difference may be intentional; it was preserved. |
| Prop/instill tan | `--color-prop: #6e9a97` vs the instill fallback `#c8aa6e` | The fallback is visually and semantically distinct from the currently resolved prop teal. |

## Audit and verification

- Exhaustive grep covered `public/css/*.css` and `views/**/*.njk`, normalizing whitespace in `rgba(...)` values for duplicate detection.
- Every repeated thematic literal remaining outside `tokens.css` is confined to the protected `app.css` regions. Other repetitions are neutral black/white alpha shadows or overlays allowed by the task.
- The original `HEAD` byte sequences for both protected regions were compared against the edited file and found unchanged.
- All 43 Nunjucks templates compiled, `home.njk` rendered, and the generated page-title/affix-title modifier classes were explicitly rendered and checked.
- `git diff --check` passes.
- No JavaScript was touched, so `node --check` was not applicable.
- The HTTP render tests could not run in this sandbox because Supertest was denied permission to bind `0.0.0.0` (`listen EPERM`). Direct Nunjucks compilation/rendering was used instead.

## Fence and scope compliance

No content in the two protected `app.css` regions was modified. No `public/js/passive-*.js`, `build-*.js`, `data/source/`, popup class names, selectors already in use, or stylesheet load order was changed. Changes are limited to the explicitly allowed CSS/template files and this report.
