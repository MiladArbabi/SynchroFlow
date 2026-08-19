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

## Public-domain deployment

`www.lasyncro.com` proxies marketing routes through `packages/landing-page/vercel.json`.

Proxied Next.js pages emit root-relative `/_next/*` assets. Therefore the landing Vercel project must proxy `/_next/:path*` to `https://synchro-flow-marketing.vercel.app/_next/:path*`.

Without that rewrite, HTML renders but CSS/JS assets 404 and pages appear as unstyled semantic HTML.

Blog visual components also depend on `/reveal.js`. Because `.reveal` starts hidden and `/reveal.js` adds `.in`, the landing Vercel project must proxy `/reveal.js` to `https://synchro-flow-marketing.vercel.app/reveal.js`. This is intentionally targeted rather than a wildcard public-asset proxy.

If `/reveal.js` is missing on `www.lasyncro.com`, Blog visuals can occupy layout space while remaining invisible even when the PNG assets themselves are present and healthy.

Do not solve this with per-page inline styling or `assetPrefix` unless the routing architecture changes.

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

MKT-UX-01C: complete.
Blog convergence onto shared primitives without reducing editorial UX.

MKT-UX-01C-PROD: complete.
Blog production visual regression fix.

MKT-UX-01C-PROD-02: implementation complete, production verification pending deployment.
Blog visual polish.

MKT-UX-01D-A: implementation complete, production verification pending deployment.
Glossary retirement.

MKT-UX-01D-B: implementation complete, production verification pending deployment.
Pilot retirement and launch conversion.

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

MKT-UX-01C Blog convergence is complete. `/blog` and `/blog/[slug]` now use the shared marketing content UX foundation.

Blog has its own dark theme boundary at `apps/marketing/app/blog/layout.tsx` and uses the same LaSyncro operational palette as Help/auth.

Blog index uses shared structural primitives while preserving its editorial composition. Blog articles no longer use legacy `ArticleLayout`; `ArticleLayout` remains unchanged for Compare, Features, and Industries.

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

## Blog visual composition

`/blog` preserves newest article as featured, client-side category filters, article count, featured visual, topic discovery cards, hover/motion behavior, newsletter `POST /api/waitlist` with `source: newsletter`, and responsive editorial hierarchy.

`/blog/[slug]` composes `ContentArticleShell` -> `ContentBreadcrumbs` -> Blog-owned header/meta -> shared MDX prose -> existing `ArticleCTA` -> existing `FAQ` -> existing `ArticleCTA` full -> existing `InternalLinks` -> `BlogArticleTracker`.

## Blog MDX and styling

Blog shared MDX typography now comes from `createContentMdxComponents`.

Blog-specific MDX components remain supported: `QuickAnswer`, `NumberedH3`, `Checklist`, `ArticleImage`, `HeroVisual`, `ArticleAnimation`, and `ProductVisual`.

No Blog MDX files were rewritten; the current 18-article corpus remains intact.

Blog uses Plus Jakarta Sans as its font authority. Blog route files no longer reference DM Sans.

Light-mode hardcoded colors were replaced by shared design tokens. `#FFFFFF` remains intentionally as `--on-accent` in the Blog theme boundary.

## Blog production visual regression

MKT-UX-01C-PROD fixed a Blog production visual regression caused by the public-domain proxy missing `/reveal.js`.

Blog visual components use the `.reveal` class. `.reveal` begins hidden and requires `/reveal.js` to add `.in`. `www.lasyncro.com/reveal.js` was not routed to the marketing deployment, while Blog PNG assets were present and healthy. Visuals therefore occupied layout space but remained invisible.

`packages/landing-page/vercel.json` now proxies `/reveal.js` to `https://synchro-flow-marketing.vercel.app/reveal.js`. This fix is intentionally targeted rather than a wildcard public-asset proxy.

The final Blog newsletter no longer uses a collapsing bottom margin. Bottom breathing room now remains inside the Blog dark-theme surface, while the global Footer remains unchanged and light.

Blog owns scoped article-spacing overrides in `apps/marketing/app/blog/blog.module.css`:

- paragraphs: 20px bottom
- H2: 42px top / 16px bottom
- H3: 32px top
- Quick Answer: 36px top
- article reveal/figure spacing: 36px vertical

Shared `apps/marketing/components/content/content.module.css` was not changed.

Existing Blog MDX visual placements were preserved. No Blog MDX files were rewritten, and existing `ArticleImage`, `HeroVisual`, and `ProductVisual` components remain shared and unchanged. Blog currently contains substantial existing visual coverage, so this issue restored rendering rather than redistributing images.

MKT-UX-01C-PROD is complete.

## Blog visual polish

MKT-UX-01C-PROD-02 polished Blog visuals after the production regression fix.

`HeroVisual` now supports optional `contentDriven?: boolean`. Default behavior remains legacy/fixed for existing non-Blog consumers, while Blog opts into content-driven rendering through its MDX component map. Blog comparison visuals can expand to fit long headings and bullet lists, and mobile Blog visuals stack without clipping or horizontal overflow.

`InternalLinks` now supports `variant?: 'legacy' | 'blogDark'`. The default remains `legacy`; Blog uses `blogDark`; `ArticleLayout` and other existing consumers keep the legacy appearance. Blog Keep Reading no longer uses `LegacyReadableSection` and now uses a dark-theme outer/container hierarchy with contrasting cards.

The Blog index hover issue came from article rows changing padding and margin geometry on hover. That moved the pointer hit area, so adjacent rows could repeatedly enter and leave hover when the pointer sat on their boundary. Blog row geometry is now constant with `padding: 28px 16px` and `margin: 0 -16px`; padding and margin are not animated. Hover only changes visual state such as background, title color, and arrow treatment.

Blog-scoped CSS resets visual/reveal horizontal margins on mobile. No shared prose CSS changes were required, and Blog MDX content was not changed.

The existing reveal-class hydration warning was observed during verification but was not introduced or resolved by this issue, and it did not block rendering.

## Blog preserved contracts

MKT-UX-01C did not change article slugs, metadata/canonicals, Article/FAQ/Breadcrumb schema, sitemap discovery, tracking, CTA frontmatter semantics, public routing, or Compare/Features/Industries/Glossary/Help.

MKT-UX-01C-PROD did not change Blog slugs/content, SEO/schema, shared content prose defaults, global Nav/Footer, Help, Compare, Features, Industries, Glossary, or shared legacy visual components.

MKT-UX-01C-PROD-02 preserved the `HeroVisual` legacy default, the `InternalLinks` legacy default, Compare's legacy `HeroVisual` behavior, `ArticleLayout`'s legacy `InternalLinks` behavior, Help, routing, SEO, and content.

## Glossary retirement

MKT-UX-01D-A retired Glossary because it had zero maintained content. Help is the canonical operational/product knowledge base, Blog remains educational/search content, and Compare remains commercial/competitor content.

`/glossary` and `/glossary/:path*` now permanently redirect to `/help`. Redirects exist in both `apps/marketing/next.config.ts` and `packages/landing-page/vercel.json`. Existing `/getting-started` -> `/help/getting-started` behavior remains unchanged.

The Glossary app routes `apps/marketing/app/glossary/page.tsx` and `apps/marketing/app/glossary/[slug]/page.tsx` were deleted. Glossary was removed from sitemap generation, no Glossary app routes remain, and no Glossary content corpus exists.

The landing footer now points to Help instead of Glossary. `llms.txt` no longer describes Glossary as a future or empty corpus. Glossary PostHog page classification was removed, `glossary` was removed from the shared MDX `ContentType`, and the glossary-specific `DefinedTerm` schema generator was removed.

`/glossary` is no longer emitted in the sitemap, and no dynamic glossary URLs are emitted. Retired URLs preserve user/search continuity through permanent redirects to `/help`, while Help remains indexed and canonical independently.

MKT-UX-01D-A preserved Help content/routes, Blog, Compare, Features, Industries, root Organization schema, shared MDX behavior for remaining content domains, public `/_next/*` and `/reveal.js` routing, and robots behavior.

## Pilot retirement and launch conversion

MKT-UX-01D-B retired the public Pilot program from the marketing story. `/pilot` now permanently redirects to `/pricing`; the Pilot page, Pilot form, and `/api/pilot-apply` marketing proxy were removed; and Pilot links were removed from marketing navigation and footers.

Backend Pilot persistence/runtime was intentionally not removed in this issue and requires a separate engineering audit before any backend route, table, migration, or notification code is changed.

Public pre-launch conversion now uses the existing waitlist pipeline:

```txt
POST /api/waitlist
```

Supported fields are `email`, optional `store`, and `source`. Launch conversion sources are `launch_nav`, `launch_home`, `launch_pricing`, `launch_compare`, and `launch_blog`. No `launch_footer` source is currently used.

`GET /api/shopify-availability` is the single Shopify availability authority. It reads `SHOPIFY_APP_AVAILABLE` and `SHOPIFY_APP_STORE_URL`; availability is true only when `SHOPIFY_APP_AVAILABLE === "true"` and `SHOPIFY_APP_STORE_URL` is non-empty.

When unavailable or misconfigured, the response is:

```json
{
  "available": false,
  "installUrl": null
}
```

Failure to fetch availability fails safe into pre-launch email capture.

Before Shopify availability, the nav shows `Notify me at launch`, the homepage shows launch email capture, Pricing shows launch capture, Compare index/articles show launch capture, and Blog articles show launch capture. Help has no inline launch capture. Copy must not promise a Shopify approval date.

Once availability is enabled, launch forms disappear, the CTA becomes `Install on Shopify`, and the returned `installUrl` becomes the destination without per-page CTA rewrites.

`packages/landing-page/index.html` cannot directly share the React conversion component, but it follows the same `/api/shopify-availability` contract, `/api/waitlist` contract, and source attribution.

MKT-UX-01D-B preserved existing Blog newsletter behavior, checklist/waitlist consumers, Help documentation UX, Blog/Compare MDX content, backend waitlist persistence, duplicate-safe waitlist semantics, and existing public routing unrelated to Pilot.
