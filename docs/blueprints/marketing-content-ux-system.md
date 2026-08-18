# Marketing Content UX System

## Purpose

Marketing content follows this hierarchy:

design tokens -> shared content primitives -> domain-specific composition -> content

Shared primitives own reusable visual structure and presentation. Domain routes retain their own semantics, business behavior, tracking, data loading, and conversion logic. MDX and content files should provide factual/editorial content, not page-layout styling.

Blog is the visual benchmark for spacing, typography, rhythm, and polish. It is not the universal route implementation, and Blog-specific semantics must stay out of shared primitives.

## Source of truth

Design tokens live in `apps/marketing/app/globals.css`.

Shared primitives live in `apps/marketing/components/content/`.

The public API lives in `apps/marketing/components/content/index.ts`. Routes should import from this barrel where practical instead of deep-importing internal files.

## Shared primitives

`ContentShell` provides standard horizontal gutters and width constraints. Supported widths are `wide` at about 1200px, `medium` at about 880px, and `article` at about 720px.

`ContentHero` provides a generic page hero with eyebrow, title, optional accent text, description, and trailing content. It follows the current marketing visual language without embedding Blog terminology.

`ContentBreadcrumbs` renders ordered, accessible breadcrumbs. Items may be linked or terminal, and internal links use Next routing.

`ContentMeta` renders compact metadata rows for values such as category, audience, reviewed date, or read time. It does not depend on any specific frontmatter type.

`ContentCard` renders a reusable bordered content surface. It can be a link card or a static container, and its title heading remains route-owned through `headingAs`.

`ContentRow` renders reusable list/index rows for article lists and grouped content. It supports optional links, metadata, trailing affordances, and route-owned heading hierarchy through `headingAs`.

`ContentArticleShell` is structural only. It composes an article-width shell with breadcrumb, header, body, footer, related, and support slots, but includes no Blog or Help assumptions.

`ContentProse` is the shared MDX typography wrapper. It scopes prose presentation so route migrations can avoid broad global selectors.

`contentMdxComponents` is the base MDX component map for shared headings, paragraphs, lists, links, tables, blockquotes, and code.

`createContentMdxComponents` lets routes extend the shared MDX map with domain-specific components while keeping the shared typography defaults.

`RelatedContent` renders generic related-resource links. It does not assume Blog, Help, Compare, or Glossary semantics.

`ContentCTA` renders a reusable callout with optional eyebrow, body, and action. Its title heading remains route-owned through `headingAs`.

## Linking rules

Internal links use `next/link`.

`http`, `https`, `mailto`, and `tel` links use normal anchors.

External links remain same-tab by default. Callers explicitly opt into `target="_blank"` when a new tab is desired.

When `_blank` is requested without `rel`, the shared link helper applies `noopener noreferrer`.

## Styling rules

Use the existing CSS design tokens instead of duplicating brand hex values. Important token families include `--accent`, `--on-accent`, `--bg*`, `--surface`, `--ink*`, `--rule*`, `--r-*`, and `--ls-*`.

Shared responsive and hover styles live in scoped `content.module.css`.

Do not add broad selectors such as `article p` for new shared content architecture. Existing global article styles may remain until a later convergence issue.

Do not introduce another styling framework. Inline styling can still exist where appropriate, but reusable shared presentation should prefer the content primitives and tokens.

## Responsive contract

The foundation supports three responsive states:

1. Desktop/default
2. <=880px
3. <=720px

Route migrations should rely on shared responsive behavior instead of duplicating route-specific breakpoints unless a route genuinely needs unique behavior.

## Ownership boundaries

| Concern | Owner |
| --- | --- |
| design palette/tokens | `globals.css` |
| shared page width/hero/cards/rows/prose | `components/content` |
| Blog editorial behavior/tracking/featured content | Blog domain |
| Help search/support/category semantics | Help domain |
| Compare-specific comparison semantics | Compare domain |
| MDX factual/editorial content | content files |

## Migration sequence

MKT-UX-01A: complete.
Shared primitives foundation.

MKT-UX-01B: complete.
Help UX migration.

MKT-UX-01C: next.
Blog convergence onto shared primitives without reducing editorial UX.

MKT-UX-01D: later.
Compare, Glossary, and grouped marketing index convergence.

Migration does not mean forcing every domain to look identical. The objective is shared visual grammar and architecture.

## Rules for future work

1. Do not create a new page-specific copy of a shared hero/card/row/prose pattern.
2. Extend the primitive when the need is genuinely reusable.
3. Keep domain semantics outside primitives.
4. Keep heading hierarchy semantic and route-owned.
5. Keep content MDX free of page layout implementation.
6. Prefer tokens over raw brand color values.
7. Do not make generic primitives silently perform navigation behavior such as opening links in new tabs.
8. Preserve accessibility and semantic HTML.

## Current state

MKT-UX-01A foundation is complete.

MKT-UX-01B Help UX migration is complete. `/help`, `/help/[category]`, and `/help/[category]/[slug]` now compose the shared content primitives.

All 53 Help MDX articles inherit the shared article/prose system through route templates; individual MDX files were not visually rewritten.

Help uses a canonical 16-category registry in `apps/marketing/lib/help.ts`. Category identity remains filesystem slug based, while the registry owns category label, description, and display order. Article counts are derived from the actual corpus.

Registry validation detects missing or orphan category definitions and unexpected frontmatter category drift.

Search remains client-side and article-metadata based; no body or fuzzy search was added.

`relatedArticles` frontmatter is now resolved into `RelatedContent`, and broken canonical Help references fail clearly.

Sitemap generation remains article/filesystem-derived and was not changed.

Existing `ArticleLayout` remains unchanged and will be considered during MKT-UX-01C Blog convergence.

## Help visual composition

`/help` composes `ContentHero` -> `HelpSearch` -> linked category `ContentCard`s -> support `ContentCTA`.

`/help/[category]` composes `ContentBreadcrumbs` -> `ContentHero` -> article count -> `ContentRow`s -> support `ContentCTA`.

`/help/[category]/[slug]` composes `ContentArticleShell` -> breadcrumbs -> Help-owned article header/meta -> shared MDX prose -> `RelatedContent` -> support `ContentCTA`.

## Help theme boundary

`apps/marketing/app/help/layout.tsx` is the Help-domain theme boundary.

Help deliberately forces the dark LaSyncro operational palette:

- `#151D29` background
- `#1C2740` surfaces
- `#243050` secondary dark
- `#F0EEE8` primary text
- `#C8C4BB` secondary text
- `#8B8F9A` muted text
- `#FF6B2B` accent

This is implemented through local CSS-variable overrides so shared primitives render consistently regardless of OS/browser color preference.

This does not make the whole marketing site dark. Global marketing Nav/Footer remain owned by `apps/marketing/app/layout.tsx`, so the global footer may remain visually separate until later marketing-shell convergence.

Future work should avoid independently duplicating this dark palette again; a shared theme contract may be extracted when multiple marketing domains adopt it.
