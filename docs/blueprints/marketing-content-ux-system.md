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

Blog index uses shared structural primitives while preserving its editorial composition. Blog articles no longer use legacy `ArticleLayout`; Compare now opts into the scoped `ArticleLayout` dark variant documented in MKT-UX-01F-B, while the legacy default remains available for Features and Industries.

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

Blog-scoped CSS resets visual/reveal horizontal margins on mobile were later replaced by shared legacy visual responsiveness in MKT-UX-01E-A. No shared prose CSS changes were required, and Blog MDX content was not changed.

The existing reveal-class hydration warning was observed during verification but was not introduced or resolved by this issue, and it did not block rendering.

## MKT-UX-01E-A — Legacy article visual responsiveness

Shared legacy `HeroVisual`, `ProductVisual`, `ArticleImage`, and `ArticleAnimation` intentionally use an approximately 40px desktop editorial breakout.

Below approximately 728px, that breakout could exceed the viewport. Shared responsive ownership now uses `article-visual-breakout`: above 728px, preserve the `-40px` horizontal breakout; at or below 728px, collapse horizontal breakout to 0 and keep visuals container-safe.

`HeroVisual` also has responsive frame, panel, and divider behavior for mobile safety.

Implementation files:

- `apps/marketing/components/article/HeroVisual.tsx`
- `apps/marketing/components/article/ProductVisual.tsx`
- `apps/marketing/components/article/ArticleImage.tsx`
- `apps/marketing/components/article/ArticleAnimation.tsx`
- `apps/marketing/app/blog/blog.module.css`
- `apps/marketing/app/globals.css`

Blog cleanup: the redundant Blog-specific horizontal `.reveal` margin reset was removed. Blog vertical rhythm and `contentDriven` behavior were preserved.

Verification: desktop breakout was preserved at 1440, 1024, 768, and 729px. Responsive behavior was verified at 728, 725, 720, 600, 390, and 320px. `/compare/stocky-alternative` shared visual overflow was 0; tested Blog shared visual overflow was 0; and the Blog `contentDriven` hero still stacks at <=720px.

No current Features or Industries article corpus existed for browser verification.

Still open/out of scope after MKT-UX-01E-A: `InternalLinks` related-card overflow and intentionally horizontally scrollable MDX tables. `/compare` index heading overflow was handled separately in MKT-UX-01E-B, and FAQ mobile grid overflow was handled separately in MKT-UX-01E-C.

MKT-UX-01E-A is implementation verified locally; production verification is pending deployment.

## MKT-UX-01E-B — Compare index responsive hero heading

The Compare index hero heading in `apps/marketing/app/compare/page.tsx` used a fixed `fontSize: 64`.

At narrow widths, the emphasized phrase `the alternatives.` contained an unbroken word wider than the available line width after the page's 5vw side padding. The first reproduced failure was approximately 372px viewport: `document.scrollWidth` exceeded `clientWidth`, while `body { overflow-x: hidden; }` masked the visible horizontal scroll.

The Compare index hero now uses responsive typography:

```txt
fontSize: 'clamp(48px, 10vw, 64px)'
```

This preserves the 64px desktop size while scaling the heading down on narrow viewports.

Preserved: exact heading wording, existing `<em>` emphasis, italic styling, existing letter-spacing, existing layout hierarchy, Compare cards/content, launch conversion, navigation, and metadata/schema.

No forced word breaking, hyphenation, or copy change was required. The implementation modified only `apps/marketing/app/compare/page.tsx`.

Verification covered 1440, 1024, 768, 600, 480, 400, 390, 375, 373, 372, 360, 340, and 320px. `document.scrollWidth === document.clientWidth` at every tested width; 373px, 372px, and 320px passed; desktop `h1` remained 64px at 1440, 1024, and 768px; the emphasized phrase remained italic/readable; and Compare cards, launch conversion, and marketing navigation were unaffected.

MKT-UX-01E-B is implementation verified locally; production verification is pending deployment.

Still open/out of scope after MKT-UX-01E-B: `InternalLinks` related-card overflow and intentionally horizontally scrollable MDX tables. FAQ mobile grid overflow was handled separately in MKT-UX-01E-C.

## MKT-UX-01E-C — FAQ mobile grid responsiveness

The shared FAQ header in `apps/marketing/components/article/FAQ.tsx` used `grid-template-columns: 1fr 2fr` with `gap: 32px` at all viewport widths.

On narrow Blog layouts, the intro paragraph exceeded the viewport because the two-column grid remained active inside the padded article footer. The first reproduced Blog failure was approximately 348px viewport: `document.scrollWidth` exceeded `clientWidth`, and the FAQ intro paragraph extended beyond the viewport.

`FAQ.tsx` now owns its responsive behavior through `.faq-header`.

Responsive contract:

- above 720px: preserve the two-column 1fr / 2fr layout and 32px gap
- at or below 720px: collapse to one column, use 24px gap, keep the heading and intro paragraph fully contained, and prevent FAQ-induced horizontal overflow

The implementation modified only `apps/marketing/components/article/FAQ.tsx`.

Preserved: FAQ label, `Common questions.` heading, intro copy, FAQ questions and answers, radio accordion behavior, plus-icon behavior, single-open behavior, FAQ schema generation, Blog composition, Compare composition, navigation, and launch conversion.

Verification covered 768, 721, 720, 600, 480, 400, 390, 375, 360, 350, 349, 348, 340, and 320px. At 768 and 721, the two-column layout remained active; at 720 and below, the one-column layout was active; 349px, 348px, and 320px passed; and FAQ-attributable horizontal overflow was 0 at every tested width.

Blog FAQ header stacks correctly on mobile and keeps the intro paragraph contained. Compare FAQ stacks correctly on mobile and preserves the desktop layout. Accordion regression testing at 390x844 and 320x700 opened two questions sequentially, preserving single-open radio behavior with labels, icons, and answers contained. Desktop verification at 1440 and 1024 preserved the 1fr / 2fr layout with 32px gap.

MKT-UX-01E-C is implementation verified locally; production verification is pending deployment.

Still open/out of scope: `InternalLinks` related-card overflow and intentionally horizontally scrollable MDX tables.

## MKT-UX-01F-A — Marketing theme, font, and shell authority

The Next marketing app now has one canonical visual authority: a forced dark brand palette, Plus Jakarta Sans as the sole loaded/canonical font, OS/browser color preference does not control the site palette, and shared nav/body/footer use the same dark shell. Route-level legacy content is migrated separately in MKT-UX-01F-B/C/D/E.

Canonical dark tokens in `apps/marketing/app/globals.css`:

```txt
--bg             #151D29
--bg-2           #1C2740
--bg-3           #243050
--surface        #1C2740
--ink            #F0EEE8
--ink-2          #C8C4BB
--ink-3          #8B8F9A
--ink-4          #5A5F6E
--rule           rgba(255,255,255,0.08)
--rule-2         rgba(255,255,255,0.14)
--accent         #FF6B2B
--accent-hover   #FF8C5A
--accent-ghost   rgba(255,107,43,0.12)
--accent-border  rgba(255,107,43,0.25)
--on-accent      #FFFFFF
```

`apps/marketing/app/globals.css` owns the dark palette directly at `:root`. The previous root/body palette switching under `prefers-color-scheme` was removed for the application shell. `html` declares `color-scheme: dark`, and `body` uses `font-family: var(--sans)`, `background: var(--bg)`, and `color: var(--ink)`.

The marketing app loads Plus Jakarta Sans through `next/font`. Both shared typography aliases resolve through `--font-plus-jakarta-sans`; do not describe DM Sans as loaded. MKT-UX-01F-E resolves the Privacy/Terms font and light-era palette debt; any legacy article/template cleanup encountered elsewhere remains separate from that legal-page scope.

Root layout no longer hard-codes light body colors. The shared footer is now dark and token-driven through `.marketing-footer`, `.marketing-footer-links`, and `.marketing-footer-link`. Navigation now uses one deterministic logo image appropriate for the dark shell; OS-theme-driven duplicate logo switching was removed. Navigation structure and destinations did not change.

Blog and Help nested layouts no longer duplicate the complete dark token block. They inherit the root visual authority while preserving their route-layout boundaries.

This work did not change `packages/landing-page/index.html` or checklist static surfaces. Those remain separate rendering owners for MKT-UX-01F-F and MKT-UX-01F-G.

Local verification covered `/blog`, `/blog/best-wms-for-shopify-small-business`, `/help/getting-started`, `/compare`, `/pricing`, `/faq`, and `/about` at desktop and mobile. Representative routes were also verified under `prefers-color-scheme: light` and `prefers-color-scheme: dark`. The body shell, nav, and footer remained dark; the logo remained deterministic; Blog/Help typography resolved to Plus Jakarta Sans; Blog/Help visual system remained intact; and the footer changed intentionally from light to dark.

Known transition state: after MKT-UX-01F-D, legacy route content for Privacy and Terms still contains light-era inline palette/font declarations. Those routes can temporarily look mixed until their convergence issue is complete.

MKT-UX-01F-A is implementation verified locally; production verification is pending deployment.

## MKT-UX-01F-B — Compare dark palette and typography convergence

MKT-UX-01F-B converged `/compare`, `/compare/brightpearl-alternative`, `/compare/cin7-alternative`, `/compare/linnworks-alternative`, and `/compare/stocky-alternative` to the canonical dark marketing system established in MKT-UX-01F-A. Pricing, FAQ standalone, About, Privacy, and Terms were not changed.

The Compare index replaced legacy light-era palette ownership with semantic tokens: `var(--ink)` for primary text, `var(--ink-2)` for secondary copy, `var(--ink-3)` for metadata, `var(--rule)` / `var(--rule-2)` for rules, `var(--bg-2)` / `var(--surface)` for hover/surfaces, `var(--accent)` for accent treatment, and `var(--on-accent)` for text on accent. The legacy light hover `#F3F2EF` was removed; comparison rows now use a dark hover surface, accent title/arrow treatment, and an explicit accent keyboard focus outline. The existing responsive H1 clamp remains preserved.

Compare index and rendered Compare article paths now use Plus Jakarta Sans through `var(--sans)`. No rendered DM Sans remains across the current Compare routes, but this does not mean DM Sans declarations were removed from the entire marketing application.

`ArticleLayout` gained an explicit scoped dark variant, and Compare opts into it. The default legacy behavior remains available for current or future Features/Industries consumers. The dark variant tokenizes breadcrumbs, H1, deck, metadata, author row, dots, and dividers. Blog does not use `ArticleLayout`; it continues to use its separate shared content article shell.

Compare articles previously inherited `ArticleLayout`'s default `Blog` breadcrumb label. Compare now explicitly passes `/compare` and `Compare`; schema breadcrumbs were already correct and were not changed.

The Compare MDX mapper converged to dark tokens and Plus Jakarta Sans for `table`, `thead`, `tr`, `th`, `td`, `h2`, `h3`, `p`, `li`, and `strong`. Table horizontal scrolling behavior remains intentionally unchanged.

Scoped dark support was added and used by Compare for `FAQ`, `InternalLinks`, `ArticleCTA`, `QuickAnswer`, `HeroVisual`, `NumberedH3`, `ProductVisual`, and `ArticleImage`. `InternalLinks` gained a generic `dark` variant while preserving existing `blogDark` behavior and the legacy default. `FAQ` preserved 720px responsive stacking and radio single-open behavior. `HeroVisual` preserved responsive breakout behavior.

CTA convergence: `CompareCTA` preserved its visual design while moving typography to `var(--sans)` and palette to semantic accent tokens. `ArticleCTA` gained a scoped dark theme used by Compare, with inline and full CTA treatments dark-compatible and destinations/labels unchanged. `LaunchNotifyForm` was already token-compatible and needed no Compare-specific change.

Local verification covered all five Compare routes at 1440x900, 768x900, 390x844, and 320x700. All returned 200, `document.scrollWidth === document.clientWidth`, Compare H1 responsive behavior remained preserved, FAQ mobile stacking remained preserved, HeroVisual breakout remained preserved, table wrapper behavior remained preserved, comparison row hover/focus was verified, and FAQ sequential-open behavior was verified.

Representative contrast results: Index H1 14.6, Index body 9.74, Filter/date 5.24, Row title 14.6, Row description 9.74, Article H1 14.6, Article body/deck/table body/FAQ answer 9.74, Table header 5.24, CTA text 8.54, and Related title/body 12.8 / 8.54. Rendered Compare DM Sans count: 0.

Unchanged content and SEO contracts: all four Compare slugs, titles, copy, MDX prose, metadata, canonical URLs, Article schema, FAQ schema, Breadcrumb schema, tracking, and launch conversion source. Only customer-facing breadcrumb rendering changed from incorrect `Blog` to `Compare`.

Implementation files:

- `apps/marketing/app/compare/page.tsx`
- `apps/marketing/app/compare/[slug]/page.tsx`
- `apps/marketing/components/article/ArticleLayout.tsx`
- `apps/marketing/components/article/FAQ.tsx`
- `apps/marketing/components/article/InternalLinks.tsx`
- `apps/marketing/components/article/ArticleCTA.tsx`
- `apps/marketing/components/compare/CompareCTA.tsx`
- `apps/marketing/components/article/QuickAnswer.tsx`
- `apps/marketing/components/article/HeroVisual.tsx`
- `apps/marketing/components/article/NumberedH3.tsx`
- `apps/marketing/components/article/ProductVisual.tsx`
- `apps/marketing/components/article/ArticleImage.tsx`

MKT-UX-01F-B is production verified and complete. All five Compare routes returned 200 across desktop, tablet, and mobile verification; dark-theme readability, Plus Jakarta Sans authority, hover/focus behavior, responsive containment, FAQ behavior, article visuals, tables, and the corrected Compare breadcrumb were verified in production.

## MKT-UX-01F-C — Pricing dark palette, typography, and billing interval convergence

MKT-UX-01F-C converges `/pricing` to the canonical dark marketing visual system and repairs the previously non-functional Monthly / Annual billing selector.

Pricing preserves its existing H1 typography as the reference treatment for primary commercial page titles going forward:

```ts
font-family: var(--sans)
font-size: clamp(38px, 5vw, 64px)
font-weight: 650
line-height: 1.05
letter-spacing: -0.045em
color: var(--ink)
```

The typography shape was intentionally preserved because it is the preferred primary-page headline treatment. Only its visual-system authority changed from a route-local Plus Jakarta Sans string and dark-on-dark legacy color to the shared `var(--sans)` and light-on-dark `var(--ink)` tokens.

Pricing no longer declares a separate DM Sans body authority. Header copy, plan cards, prices, labels, billing controls, features, footer copy, and pricing CTAs use Plus Jakarta Sans through `var(--sans)`.

The server/client boundary remains deliberate. `apps/marketing/app/pricing/page.tsx` stays a server component and continues to own Metadata, canonical URL, WebPage schema, and the static page header. Interactive pricing behavior is isolated in the client component `apps/marketing/components/pricing/PricingPlans.tsx`.

The previous Monthly / Annual control was visual only: two static `<span>` elements with no state or interaction. `PricingPlans` now owns billing interval state and renders Monthly and Annual as accessible buttons with `aria-pressed`, keyboard-operable native button behavior, visible selected state, and accent focus-visible treatment.

Monthly remains the default public display:

- Core: `$79/mo`
- Growth: `$179/mo`
- Scale: `$349/mo`
- Starter: `Free`

Annual mode uses the existing canonical USD annual totals rather than calculating an assumed discount in the marketing UI. The monthly-equivalent display is annual total divided by 12:

- Core: `$65.83/mo`, billed `$790/year`
- Growth: `$143.20/mo`, billed `$1,718.40/year`
- Scale: `$279.20/mo`, billed `$3,350.40/year`
- Starter remains `Free`

Annual cards also expose the exact annual billed amount and exact savings versus twelve monthly payments.

The canonical pricing configuration currently contains annual amounts whose effective discount is not identical across every tier/currency despite older documentation describing annual billing as a flat 20% discount. MKT-UX-01F-C does not alter backend pricing, Stripe Price IDs, Shopify billing, or canonical billing configuration. The public Pricing page therefore avoids inventing a new 20% calculation and replaces the blanket `Annual billing saves 20%` presentation with factual annual billing wording and exact price-derived savings.

Visual convergence replaces the old light pricing surfaces (`#FAFAF9`, `#FFF5F0`, `#FFFFFF`, `#F3F2EF`, `#E8E6E0`, and related light-era text colors) with canonical semantic tokens. Standard plan cards use the dark surface/rule system. Growth remains the emphasized recommendation through `var(--accent-ghost)` and `var(--accent-border)` rather than the former peach card.

`PricingPlanCTA` now uses `var(--sans)` plus semantic accent tokens. Its destination remains `https://app.lasyncro.com`, its existing `pricing_plan_cta_clicked` PostHog event remains intact, and the selected `billing_interval` is now included in that event for attribution.

`LaunchNotifyForm` was already token-compatible and remains unchanged. Its `source="launch_pricing"` contract is preserved.

Unchanged contracts: `/pricing` metadata, canonical URL, WebPage schema, plan names, existing feature copy, launch conversion source, CTA destination, and backend/Shopify/Stripe billing behavior.

Implementation files:

- `apps/marketing/app/pricing/page.tsx`
- `apps/marketing/components/pricing/PricingPlans.tsx`
- `apps/marketing/components/pricing/PricingPlanCTA.tsx`

Local verification: the marketing production build compiled successfully, TypeScript passed, and all 106 static pages generated successfully with `/pricing` remaining statically prerendered. Interactive visual verification is intentionally deferred to the deployed production route after commit/push.

MKT-UX-01F-C is production verified and complete. `/pricing` renders the canonical dark palette and Pricing H1 authority in production; Monthly and Annual both switch correctly; Monthly renders `$79`, `$179`, and `$349`; Annual renders the canonical monthly-equivalent prices and annual billed totals; Growth remains visually emphasized; and launch conversion/footer content remain readable and contained.

## MKT-UX-01F-D — FAQ + About dark palette, title, and responsive convergence

MKT-UX-01F-D converges `/faq` and `/about` to the canonical dark marketing visual system and applies the Pricing H1 treatment as the shared primary-page title authority.

Both page H1s now use:

```txt
font-family: var(--sans)
font-size: clamp(38px, 5vw, 64px)
font-weight: 650
line-height: 1.05
letter-spacing: -0.045em
color: var(--ink)
```

About preserves its intentional orange italic emphasis on `run their own warehouse.` while the base H1 uses the same typography and light-on-dark contrast as Pricing.

FAQ and About no longer declare DM Sans or route-local Plus Jakarta Sans strings. Their rendered typography uses the shared `var(--sans)` authority.

FAQ replaces its legacy dark text and light rules/surfaces with `var(--ink)`, `var(--ink-2)`, `var(--rule)`, `var(--accent)`, `var(--accent-ghost)`, `var(--accent-border)`, and `var(--on-accent)`. The contact callout remains visually emphasized without reintroducing a light-theme card.

FAQ rows retain the existing two-column question/answer composition above 720px and collapse to one column at or below 720px. All FAQ copy, FAQPage schema, metadata, canonical URL, questions, answers, and mailto destination remain unchanged.

About replaces legacy light-era H1/body/rule/stats colors with semantic dark tokens. Its body/image composition remains two-column above 880px and stacks to one column at or below 880px. The three-card stats strip remains three-column above 720px and becomes one column at or below 720px.

About preserves Organization schema, AboutPage schema, metadata, canonical URL, Open Graph metadata, copy, `ArticleImage`, image source/alt/caption, Blog CTA destination, and `about_cta_clicked` analytics.

`AboutCTAs` no longer owns a second top divider and top padding. The About page section is the single owner of that boundary, removing the previous duplicate rule/spacing while preserving CTA behavior.

Implementation files:

- `apps/marketing/app/faq/page.tsx`
- `apps/marketing/app/about/page.tsx`
- `apps/marketing/components/about/AboutCTAs.tsx`
- `docs/blueprints/marketing-content-ux-system.md`

MKT-UX-01F-D base convergence is locally build-verified. Production inspection confirmed the new FAQ/About title authority and dark-theme contrast are active, but exposed one About-only layout defect: the intended right-side warehouse visual was rendered in the HTML but remained visually hidden.

## MKT-UX-01F-D-PROD-01 — About body visual visibility

Production verification showed the About body copy occupying only the left half of its desktop two-column layout while the intended right-side visual appeared empty.

Audit confirmed that `apps/marketing/app/about/page.tsx` already renders `ArticleImage` with `floorplanning-4.png`, the asset exists under `apps/marketing/public/`, and production HTML contains the corresponding `/floorplanning-4.png` image element.

The root cause is shared article reveal behavior rather than an asset or routing failure. `ArticleImage` renders with the shared `reveal article-visual-breakout` classes. Global `.reveal` CSS starts at `opacity: 0` and requires an `.in` state, while the standalone About route does not own that article reveal lifecycle.

The production fix remains About-scoped rather than changing shared article behavior:

- the About body explicitly restores `opacity: 1` and `transform: none` for its nested `.article-visual-breakout`;
- article-specific negative breakout margins are neutralized inside the About two-column grid;
- the existing `ArticleImage` now opts into `variant="dark"` so its border, caption, and supporting treatment use the canonical dark visual system;
- the existing two-column desktop composition and responsive single-column behavior remain unchanged;
- About copy, metadata, schemas, image asset, alt text, caption, and CTA contracts remain unchanged.

Implementation files:

- `apps/marketing/app/about/page.tsx`
- `docs/blueprints/marketing-content-ux-system.md`

MKT-UX-01F-D-PROD-01 is production verified and complete. The About warehouse visual is visible in the intended right-hand desktop column, uses the dark ArticleImage variant, remains contained without article breakout margins, and restores the intended balanced two-column composition.

MKT-UX-01F-D — FAQ + About convergence is fully closed.

## MKT-UX-01F-E — Privacy + Terms convergence

Status: production verified; closed.

Audit confirmed that both public legal routes were healthy (`/privacy` and `/terms` returned `200`) but their route-local visual styling had drifted from the canonical marketing system.

Privacy debt before convergence:

- body, eyebrow, and updated-date text still declared `DM Sans`;
- route-local text and rule colors used light-era values including `#0F0E0D`, `#3A3835`, `#6B7280`, and `#E8E6E0`;
- the page title used a legacy `48px / 400 / 1.18 / -0.02em` treatment;
- section headings used a separate `24px / 400` treatment.

Terms debt before convergence:

- the page title used a route-local `2.5rem / 700` treatment;
- ten section headings used `1.25rem / 600`;
- body and muted text used light-era `#374151` and `#6B7280`;
- typography relied on inherited/default styling rather than explicitly adopting the shared marketing font authority.

Implementation:

- both legal pages now use `var(--sans)` for route-local typography;
- both primary titles use the canonical marketing H1 authority: `clamp(38px, 5vw, 64px) / 650 / 1.05 / -0.045em`;
- both pages use `24px / 600 / 1.25 / -0.02em` section-heading treatment with `var(--ink)`;
- readable legal body copy uses `var(--ink-2)`, muted metadata uses `var(--ink-3)`, and separators use `var(--rule)`;
- orange legal links and the Privacy eyebrow use the canonical `var(--accent)` / `var(--accent-border)` authority;
- all Privacy `DM Sans` declarations and audited light-era legal-page colors were removed;
- legal copy, dates, metadata, schemas, Shopify permission statements, trial/billing wording, links, and contact addresses were not intentionally changed.

Implementation files:

- `apps/marketing/app/privacy/page.tsx`
- `apps/marketing/app/terms/page.tsx`
- `docs/blueprints/marketing-content-ux-system.md`

Local verification:

- `git diff --check` passed;
- both legal pages report zero audited `DM Sans` references and zero audited light-era color references;
- `npm run build` in `apps/marketing` compiled successfully, completed TypeScript validation, and generated all 106 static/generated routes including `/privacy` and `/terms`.

Production verification passed on desktop and mobile for both `/privacy` and `/terms`: both routes return `200`, render the canonical Plus Jakarta Sans typography and dark token palette, retain readable legal body contrast and accent links, and show no observed horizontal overflow, clipping, or responsive navigation regression.

## MKT-UX-01G-A — Primary page-title convergence

MKT-UX-01G-A establishes the Pricing H1 treatment as the shared primary-page title authority across the remaining marketing hub surfaces that had visibly drifted.

Canonical primary-page H1 typography:

```txt
font-family: var(--sans)
font-size: clamp(38px, 5vw, 64px)
font-weight: 650
line-height: 1.05
letter-spacing: -0.045em
color: var(--ink)
```

The shared `ContentHero` primitive is used only by the Blog index, Help root, and Help category hubs. Its previous `56px / 400 / 1.16 / -0.02em` title styling and separate 48px/40px responsive overrides were replaced by the canonical clamp-based Pricing authority.

This means Blog index, Help root, and Help category hubs now inherit the same primary-title typography without route-local duplication.

The Compare index owns its H1 locally rather than through `ContentHero`. Its previous `clamp(48px, 10vw, 64px) / 400 / 1.18 / -0.02em` treatment was replaced with the same Pricing authority while preserving its orange italic `the alternatives.` emphasis and existing route-specific max width.

Pricing, FAQ, and About already use this H1 authority and require no 01G-A changes.

Blog article titles and Help article titles remain intentionally outside this issue. They are editorial/article headline treatments rather than primary hub-page H1s and retain their separate sizing hierarchy.

Implementation files:

- `apps/marketing/components/content/content.module.css`
- `apps/marketing/app/compare/page.tsx`
- `docs/blueprints/marketing-content-ux-system.md`

MKT-UX-01G-A is production verified and complete. Blog index, Compare index, Help root, and Help category hubs now use the canonical Pricing primary-page title authority without introducing visible wrapping or layout regressions on the verified desktop surfaces.

## MKT-UX-01H-A — Help Center navigation discoverability

The canonical public Help Center exists at `/help`, but audit found that public marketing navigation did not expose that root route directly.

Before this change:

- the marketing header exposed `Getting started`, linking directly to `/help/getting-started`;
- the shared footer had no Help link;
- authenticated application users retained a separate `Get help` action inside the application shell;
- both `/help` and `/help/getting-started` were healthy public routes.

The public navigation contract is now:

- the marketing header exposes `Help` linking to `/help`;
- the same `Help` entry is inherited by the mobile menu because desktop and mobile both render from the shared `navLinks` array;
- the shared marketing footer exposes `Help` linking to `/help`;
- `Getting Started` remains a Help Center category reached from the canonical `/help` landing page;
- the authenticated application-shell `Get help` behavior remains unchanged;
- no Help routes, Help content, search behavior, or responsive navigation CSS are changed by this issue.

Implementation files:

- `apps/marketing/components/navigation/MarketingNav.tsx`
- `apps/marketing/app/layout.tsx`
- `docs/blueprints/marketing-content-ux-system.md`

MKT-UX-01H-A is production verified and complete. Desktop header, mobile menu, and shared footer all expose `Help` and route to `/help` without responsive navigation regression.

## MKT-UX-01G-B — Shared hover and focus-state convergence

Audit grouped marketing interactions by interaction type rather than forcing every clickable surface into one animation.

Already aligned and unchanged:

- Help `ContentCard` surfaces pair `:hover` and `:focus-visible` with the canonical accent-border, `var(--bg-2)`, and subtle lift treatment;
- Help `ContentRow` surfaces pair `:hover` and `:focus-visible`;
- shared marketing navigation and footer links already pair hover and keyboard-focus treatment;
- Pricing billing controls already provide focus-visible behavior;
- the live FAQ page contact CTA already has explicit hover and focus-visible treatment.

The remaining live hub-page drift was concentrated in Blog and Compare.

Blog convergence:

- latest-post rows now use CSS for both `:hover` and `:focus-visible`;
- mouse-only `hoveredSlug`, `onMouseEnter`, and `onMouseLeave` state was removed;
- latest-row title and arrow emphasis therefore works for keyboard focus as well as pointer hover;
- the featured `Read the full guide` link pairs hover and focus-visible;
- filter tabs pair hover and focus-visible using the active accent-ghost interaction language;
- topic cards pair hover and focus-visible and adopt the same accent-border, dark-surface, and subtle lift language used by shared content cards;
- interactive Blog surfaces receive a visible accent focus outline.

Compare convergence:

- comparison rows now apply the same background, title-accent, and arrow-shift treatment for both pointer hover and keyboard focus-visible;
- the existing custom accent focus outline is preserved;
- comparison content, links, ordering, metadata, and responsive structure are unchanged.

Legacy `.faq-item` summary rules in `apps/marketing/app/globals.css` were audited but intentionally left unchanged because no current route/component consumer was found outside that legacy global definition. They are not used as authority for the live FAQ page.

Implementation files:

- `apps/marketing/app/blog/BlogIndex.tsx`
- `apps/marketing/app/compare/page.tsx`
- `docs/blueprints/marketing-content-ux-system.md`

MKT-UX-01G-B is production verified and complete. Blog latest rows, filter tabs, topic cards, featured read link, and Compare rows now provide equivalent pointer-hover and keyboard-focus interaction states without reported layout or overflow regressions.

## MKT-ROUTE-01 — Public trailing-slash normalization

Production audit found that canonical marketing routes worked without a trailing slash but returned the static Vercel `404 NOT_FOUND` response when the same public URL ended in `/`.

Affected examples included:

- `/help/`
- `/help/receiving/`
- `/blog/`
- `/compare/`
- `/pricing/`
- `/faq/`
- `/about/`

The direct `synchro-flow-marketing.vercel.app` deployment behaved correctly: trailing-slash variants returned `308` redirects to the canonical no-slash route. This proved that Next.js route generation and the marketing application were healthy.

The defect was isolated to the static `packages/landing-page` deployment that fronts `www.lasyncro.com` and proxies marketing paths to the Next.js deployment.

Implementation:

- `packages/landing-page/vercel.json` now explicitly sets `"trailingSlash": false`;
- no individual Help, Blog, Compare, Pricing, FAQ, or About routes were modified;
- `apps/marketing/next.config.ts` and `apps/marketing/vercel.json` remain unchanged;
- the canonical contract is `/path` → content and `/path/` → `308` redirect to `/path`.

Implementation file:

- `packages/landing-page/vercel.json`

MKT-ROUTE-01 implementation is applied; production redirect verification remains pending after deployment.

## MKT-UX-01F-F — Static landing-page typography convergence

Status: production verified; closed.

The public `/` route is owned by the standalone static document `packages/landing-page/index.html`, separate from the Next.js marketing application.

Audit confirmed that the root page declared two typography families but loaded neither:

- `--serif` requested Plus Jakarta Sans with a Georgia fallback;
- `--sans` requested DM Sans with a system fallback;
- the hero H1 independently used an inline Plus Jakarta Sans declaration with a generic serif fallback;
- ten footer links independently requested DM Sans;
- no Google Fonts or local `@font-face` resource loaded either named family.

That produced a visible typography mismatch on the public landing page, including a serif fallback in the primary hero title.

Implementation converges the standalone page with the marketing typography authority:

- Plus Jakarta Sans is explicitly loaded from Google Fonts;
- both `--serif` and `--sans` now resolve to Plus Jakarta Sans;
- all eleven legacy DM Sans references were removed;
- the Georgia fallback was removed;
- the primary display token now uses `clamp(38px, 5vw, 64px)`, weight `650`, line-height `1.05`;
- the hero H1 uses the same canonical title scale with `-0.045em` letter-spacing;
- the existing orange italic emphasis on `splitting apart.` is preserved;
- copy, imagery, layout, animations, conversion form, and section composition are unchanged.

Implementation file:

- `packages/landing-page/index.html`

Local source verification confirms `DM Sans = 0`, `Georgia = 0`, the Plus Jakarta Sans loader is present, and the canonical hero title authority is applied.

Production verification passed on desktop and mobile: Plus Jakarta Sans renders consistently, the canonical hero title treatment is live, the orange italic emphasis is preserved, the launch form remains usable, and no horizontal overflow or layout regression was observed.

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

## Mobile marketing navigation

MKT-UX-01D-B-PROD-01 fixed the mobile marketing navigation after launch conversion made the nav CTA customer-critical.

The original marketing navigation used a single horizontal flex row. At narrow viewports, the launch CTA and later nav items were pushed outside the viewport. `body { overflow-x: hidden; }` masked the layout overflow, so the CTA became clipped instead of producing visible page scroll. The failure became reproducible at approximately 480px and functionally unusable around 390px and below.

Desktop above 720px preserves the existing navigation: Blog, Compare, Pricing, Getting started, FAQ, About, and the launch-aware CTA.

Mobile at `@media (max-width: 720px)` keeps the logo, launch-aware CTA, and Menu button directly visible. The six navigation links move into a vertical mobile dropdown.

Implementation:

- new: `apps/marketing/components/navigation/MarketingNav.tsx`
- updated: `apps/marketing/app/layout.tsx`
- updated: `apps/marketing/app/globals.css`
- updated: `apps/marketing/components/conversion/LaunchNavCTA.tsx`

Accessibility behavior: the Menu button uses `aria-expanded` and `aria-controls`; the menu toggles open and closed; navigation link selection closes the menu; Escape closes the menu; and the existing `LaunchNavCTA` dialog behavior is preserved.

Responsive contract: at 320px the logo, launch CTA, and Menu are fully visible and clickable, with no page-level horizontal overflow.

Verification covered 1440, 1024, 768, 721, 720, 600, 480, 390, 375, and 320px. On Pricing, `scrollWidth === clientWidth` at every tested width. The mobile modal was verified through the actual visible CTA at 390x844, 375x812, and 320x700. Routes verified: `/pricing`, `/compare`, `/compare/stocky-alternative`, `/blog/best-wms-for-shopify-small-business`, and `/help`. Desktop behavior was preserved.

Out of scope: `/compare/stocky-alternative` still has an existing non-navigation horizontal overflow. At 390px, document width measured 411px because existing `figure.reveal` content extends beyond the viewport. Marketing nav itself measured inside the viewport and is not the cause; handle this as a separate issue.

MKT-UX-01D-B-PROD-01 is implementation verified locally; production verification is pending deployment.
