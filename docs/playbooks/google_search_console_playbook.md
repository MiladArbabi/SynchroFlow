# Google Search Console Playbook

## Scope

This playbook records the technical indexing and Search Console architecture for `lasyncro.com`.

Primary canonical host:

- `https://www.lasyncro.com`

Primary sitemap:

- `https://www.lasyncro.com/sitemap.xml`

Search Console property:

- `sc-domain:lasyncro.com`

---

## AN-GSC-01 — Technical / Indexing Audit

Audit date: 2026-09-04

### Production indexing baseline

Production sitemap:

- HTTP 200
- 100 URLs
- 0 duplicate URLs
- 0 non-canonical-host URLs
- 0 malformed `lastmod` values
- 0 sitemap URL redirects
- 0 sitemap URL `noindex`
- 0 sitemap URL canonical mismatches
- 0 sitemap URL `X-Robots-Tag` restrictions
- 0 orphan sitemap URLs

Canonical host behavior:

- `http://lasyncro.com/` ultimately resolves to `https://www.lasyncro.com/`
- `https://lasyncro.com/` redirects to `https://www.lasyncro.com/`
- `http://www.lasyncro.com/` redirects to `https://www.lasyncro.com/`
- marketing routes use `https://www.lasyncro.com` canonicals

Google Search Console sitemap state:

- status: Success
- discovered pages: 100
- last read: 2026-09-04
- sitemap processed successfully

HTTPS report:

- non-HTTPS URLs: 0
- critical HTTPS issues: 0

### Google indexing state observed

Page indexing report:

- indexed: 65
- not indexed: 49

Non-indexed reasons:

- 41 — Discovered, currently not indexed
- 5 — Page with redirect
- 1 — Not found (404)
- 1 — Alternate page with proper canonical tag
- 1 — Crawled, currently not indexed

Assessment:

- The 41 discovered/not-indexed URLs are predominantly the newly published Help Center corpus. Their GSC state showed `Last crawled: N/A`; no technical blocking defect was found.
- The 5 redirect URLs are expected host/protocol or legacy-content redirects.
- The 404 is `https://t.lasyncro.com/`, the PostHog proxy root, which intentionally returns 404.
- The alternate canonical is a tracking-parameter homepage URL and correctly canonicalizes to the clean homepage.
- The crawled/not-indexed URL is `/favicon.ico`; no indexing is required.

Conclusion:

There is no evidence of a systemic Google indexing failure.

---

## Finding 1 — Robots source of truth

### Audit result

Two robots sources existed:

- `apps/marketing/app/robots.ts`
- `packages/landing-page/robots.txt`

The landing Vercel project contains a rewrite:

`/robots.txt` → `https://synchro-flow-marketing.vercel.app/robots.txt`

However, the physical static file `packages/landing-page/robots.txt` shadowed that rewrite.

Production hash comparison proved:

- `www.lasyncro.com/robots.txt` matched `packages/landing-page/robots.txt`
- it did not match the direct marketing deployment robots output

This created two competing sources of truth.

### Resolution

Implemented:

- deleted `packages/landing-page/robots.txt`
- retained the landing-page `/robots.txt` rewrite to the marketing deployment
- added `FacebookBot` to `apps/marketing/app/robots.ts` so existing crawler access is preserved
- `apps/marketing/app/robots.ts` is now the intended single authoritative robots source

### Regression contract

Added:

`tests/contract/robots-source-of-truth.contract.test.ts`

The contract proves:

1. the landing package cannot contain a shadowing `robots.txt`
2. the landing Vercel rewrite still routes `/robots.txt` to the marketing deployment
3. the authoritative marketing robots source preserves the crawler allowlist and sitemap URL

Verification:

- targeted contract: 3/3 PASS
- marketing production build: PASS
- `git diff --check`: PASS

Production certification remains required after deployment.

---

## Open findings

These findings remain deliberately unimplemented after Finding 1:

### Finding 2 — Sitemap freshness — RESOLVED

Audit found 19 of 100 sitemap URLs receiving deployment/build-time `lastmod` values instead of true content-change timestamps.

Resolution:

- `/blog` freshness derives from the newest blog content date
- `/compare` derives from the newest comparison content date
- `/help` derives from the newest Help article date
- Help category hubs derive from the newest article within that category
- blog/compare/help articles use `lastReviewed`, then `date`
- future industry/feature routes omit `lastModified` until trustworthy metadata exists
- `Date.now()` and bare `new Date()` are forbidden as sitemap freshness fallbacks

Regression contract:

`tests/contract/sitemap-lastmod.contract.test.ts`

Verification:

- targeted contract: 4/4 PASS
- marketing production build: PASS
- volatile `lastModified` source check: NONE
- `git diff --check`: PASS

Production certification remains required after deployment.

### Finding 3 — Redirecting internal link

The landing-page footer links:

`/getting-started`

Production returns:

`308 → /help/getting-started`

Internal links should point directly to the canonical destination.

### Finding 4 — Redundant canonical redirect hop

`http://lasyncro.com/`

currently resolves through:

`http://lasyncro.com/`
→ `https://lasyncro.com/`
→ `https://www.lasyncro.com/`

The canonical destination is correct, but the first request takes two redirect hops.

---

## Help Center indexing policy

Public Help Center content should remain indexable when it is:

- unique
- useful without authentication
- stable
- substantive
- directly answers merchant or operator questions

Current Help articles satisfy that model and should remain in the sitemap.

Populated category hubs may remain indexable.

Empty, duplicate, obsolete, private, or account-specific documentation should not be published as public indexable content.
