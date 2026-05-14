// app/blog/BlogIndex.tsx  ← save as this filename
// Client component — receives pre-loaded articles from the server page.tsx.
// Handles filter tabs, hover states, newsletter form.
// Import from page.tsx: import BlogIndex from './BlogIndex'

'use client'

import { useState } from 'react'
import type { ContentItem } from '@/lib/mdx'

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/** Map tag → display label */
const TAG_LABELS: Record<string, string> = {
  shopify:   'Shopify',
  inventory: 'Inventory',
  sync:      'Sync',
  operations:'Operations',
  suppliers: 'Suppliers',
  compare:   'Compare',
  wms:       'WMS',
  picking:   'Pick & Pack',
  receiving: 'Receiving',
  workforce: 'Workforce',
  returns:   'Returns',
}

function tagLabel(t: string): string {
  return TAG_LABELS[t] ?? t.charAt(0).toUpperCase() + t.slice(1)
}

/** Derive category from first tag (used for filter tabs) */
function postCategory(tags: string[]): string {
  const CATS = ['inventory', 'operations', 'suppliers', 'compare', 'wms', 'receiving', 'workforce']
  return tags.find(t => CATS.includes(t)) ?? tags[0] ?? 'other'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ArrowRight({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>
    </svg>
  )
}

/** Animated dot for eyebrow labels */
function EyebrowDot() {
  return (
    <span style={{
      width: 6, height: 6, borderRadius: '50%',
      background: 'var(--accent)',
      display: 'inline-block',
      animation: 'blink 2.4s ease-in-out infinite',
    }} />
  )
}

// ── Featured visual (grid illustration matching design) ───────────────────────

function FeaturedVisual() {
  return (
    <div style={{
      border: '1px solid var(--rule)',
      borderRadius: 'var(--r-lg)',
      overflow: 'hidden',
      background: 'var(--bg-2)',
      aspectRatio: '5/4',
      position: 'relative',
    }}>
      {/* Grid background */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `
          radial-gradient(ellipse 70% 55% at 50% 40%, rgba(255,107,43,0.04), transparent 75%),
          linear-gradient(180deg, var(--bg) 0%, var(--bg-2) 100%)
        `,
      }} />
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `
          linear-gradient(var(--rule) 1px, transparent 1px),
          linear-gradient(90deg, var(--rule) 1px, transparent 1px)
        `,
        backgroundSize: '28px 28px',
        WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, #000 15%, transparent 75%)',
        maskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, #000 15%, transparent 75%)',
        opacity: 0.5,
        pointerEvents: 'none',
      }} />

      {/* Three-column layout */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'grid', gridTemplateColumns: '1fr auto 1fr',
      }}>
        {/* Left col */}
        <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14 }}>
          <span style={{ font: 'var(--t-micro)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
            What Shopify tracks
          </span>
          <h4 style={{ font: '400 22px/1.15 var(--serif)', letterSpacing: 'var(--ls-tight)', color: 'var(--ink)', margin: 0 }}>
            Inventory<br />visibility
          </h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', display: 'grid', gap: 6 }}>
            {['Stock counts per variant', 'Multi-location toggling', 'Transfer records'].map(item => (
              <li key={item} style={{ font: '300 12.5px/1.4 var(--sans)', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--ink-4)', flexShrink: 0 }} />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Middle arrow */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 18px', position: 'relative' }}>
          <span style={{
            position: 'absolute', top: '14%', bottom: '14%', left: '50%', width: 1,
            background: 'linear-gradient(180deg, transparent, var(--rule-2) 20%, var(--rule-2) 80%, transparent)',
          }} />
          <span style={{
            width: 34, height: 34, borderRadius: '50%',
            background: 'var(--accent-ghost)', border: '1px solid var(--accent-border)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent)', position: 'relative', zIndex: 1,
          }}>
            <ArrowRight size={12} />
          </span>
        </div>

        {/* Right col */}
        <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14 }}>
          <span style={{ font: 'var(--t-micro)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--accent)' }}>
            What a WMS adds
          </span>
          <h4 style={{ font: '400 22px/1.15 var(--serif)', letterSpacing: 'var(--ls-tight)', color: 'var(--ink)', margin: 0 }}>
            Warehouse<br />operations
          </h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', display: 'grid', gap: 6 }}>
            {['Bin & location tracking', 'Scan-based receiving', 'Immutable event ledger'].map(item => (
              <li key={item} style={{ font: '300 12.5px/1.4 var(--sans)', color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

// W: shared horizontal constraint applied to every top-level section.
// layout.tsx <main> provides only nav clearance (paddingTop: 60px) — no horizontal padding.
const W = { maxWidth: '1200px', margin: '0 auto', padding: '0 5vw' } as const

export default function BlogIndex({ articles: allArticles }: { articles: ContentItem[] }) {

  // Derive unique categories from articles for filter tabs
  const categories = Array.from(
    new Set(allArticles.map(a => postCategory(a.frontmatter.tags)))
  )

  const [activeCategory, setActiveCategory] = useState('all')
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null)

  const featured = allArticles[0]
  const remaining = allArticles.slice(1)

  const filtered = activeCategory === 'all'
    ? remaining
    : remaining.filter(a => postCategory(a.frontmatter.tags) === activeCategory)

  // Derive topics with article counts
  const topicMap: Record<string, number> = {}
  for (const a of allArticles) {
    const cat = postCategory(a.frontmatter.tags)
    topicMap[cat] = (topicMap[cat] ?? 0) + 1
  }
  const topics = Object.entries(topicMap).sort((a, b) => b[1] - a[1])

  const TOPIC_DESCRIPTIONS: Record<string, string> = {
    inventory:  'Why your shelf and Shopify disagree — and how to close the gap permanently.',
    operations: '2 to 4 hours a week on data repair instead of growth. Here\'s the fix.',
    suppliers:  'Every PO is a rating. On-time, accuracy, and damage scores from your history.',
    compare:    'Cin7, Linnworks, ShipHero, Stocky — operator-honest comparisons.',
    wms:        'What warehouse management actually means for a Shopify SMB.',
    receiving:  'Scan-to-receive, discrepancy detection, supplier scorecards.',
    workforce:  'Scheduling, task assignment, and accountability — without enterprise complexity.',
    returns:    'Returns area inventory is invisible stock. How to fold it back in.',
  }

  return (
    <>
      <style>{`
        @keyframes blink {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(.75); opacity: .4; }
        }
        .reveal { opacity: 0; transform: translateY(18px); transition: opacity .6s ease, transform .6s ease; }
        .reveal.in { opacity: 1; transform: translateY(0); }
        .post-row { transition: padding .2s, background .15s; }
        .post-row:hover { background: var(--bg-2); border-radius: 8px; }
        .post-title { transition: color .15s; }
        .post-row:hover .post-title { color: var(--accent) !important; }
        .post-arrow { transition: color .15s, transform .15s; }
        .post-row:hover .post-arrow { color: var(--accent) !important; transform: translateX(4px); }
        .read-link { transition: color .15s, border-color .15s, gap .15s; }
        .read-link:hover { color: var(--accent) !important; border-color: var(--accent) !important; gap: 12px !important; }
        .filter-tab { transition: all .15s; cursor: pointer; }
        .topic-card { transition: background .15s; cursor: pointer; }
        .topic-card:hover { background: var(--bg-2) !important; }
        @media (max-width: 880px) {
          .post-row-grid { grid-template-columns: 1fr !important; gap: 8px !important; }
          .post-tag { order: -1; }
          .post-date { order: 3; }
          .post-arrow-col { display: none !important; }
        }
        @media (max-width: 720px) {
          .page-h1 { font-size: 42px !important; }
          .featured-grid { grid-template-columns: 1fr !important; gap: 28px !important; }
          .newsletter-grid { grid-template-columns: 1fr !important; padding: 28px !important; }
          .topic-grid { grid-template-columns: 1fr !important; }
          .topics-title-row { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* ── Page header ───────────────────────────────────────────── */}
      <header style={{ ...W, padding: '96px 5vw 56px' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          font: 'var(--t-micro)', letterSpacing: 'var(--ls-eyebrow)',
          textTransform: 'uppercase', color: 'var(--accent)',
          marginBottom: 22,
        }}>
          <EyebrowDot />
          The operator`s library
        </div>
        <h1
          className="page-h1"
          style={{
            font: '400 64px/1.18 var(--serif)',
            letterSpacing: 'var(--ls-tight)',
            color: 'var(--ink)',
            margin: '0 0 32px',
            maxWidth: 820,
          }}
        >
          Operational intelligence for merchants who{' '}
          <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>
            run their own warehouse.
          </em>
        </h1>
        <p style={{
          font: '300 18px/1.55 var(--sans)',
          color: 'var(--ink-2)',
          maxWidth: 560,
          margin: 0,
        }}>
          Guides, post-mortems, and field notes for Shopify operators stuck between
          spreadsheets and enterprise systems they don`t need.
        </p>
      </header>

      {/* ── Filter strip ──────────────────────────────────────────── */}
      <div style={{
        ...W, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 24, padding: '18px 5vw',
        borderTop: '1px solid var(--rule)',
        borderBottom: '1px solid var(--rule)',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {['all', ...categories].map(cat => (
            <button
              key={cat}
              className="filter-tab"
              onClick={() => setActiveCategory(cat)}
              style={{
                padding: '8px 14px',
                font: 'var(--t-ui)', color: activeCategory === cat ? 'var(--accent)' : 'var(--ink-3)',
                borderRadius: 'var(--r-pill)',
                border: activeCategory === cat ? '1px solid var(--accent-border)' : '1px solid transparent',
                background: activeCategory === cat ? 'var(--accent-ghost)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              {cat === 'all' ? 'All' : tagLabel(cat)}
            </button>
          ))}
        </div>
        <div style={{ font: 'var(--t-ui-sm)', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ font: '400 16px var(--serif)', color: 'var(--ink)', fontStyle: 'italic' }}>
            {allArticles.length}
          </span>
          articles published
        </div>
      </div>

      {/* ── Featured article ──────────────────────────────────────── */}
      {featured && (
        <section
          className="featured-grid"
          style={{
            ...W, padding: '56px 5vw 32px',
            display: 'grid',
            gridTemplateColumns: '1.05fr 1fr',
            gap: 56,
            alignItems: 'stretch',
          }}
        >
          <a href={`/blog/${featured.slug}`} aria-label="Featured article" style={{ display: 'block' }}>
            <FeaturedVisual />
          </a>

          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                padding: '5px 12px',
                background: 'var(--surface)',
                border: '1px solid var(--accent-border)',
                borderRadius: 'var(--r-pill)',
                font: 'var(--t-micro)', letterSpacing: 'var(--ls-eyebrow)',
                textTransform: 'uppercase', color: 'var(--accent)',
              }}>
                Featured · Latest
              </span>
              <span style={{ font: 'var(--t-body-sm)', color: 'var(--ink-3)' }}>
                {formatDate(featured.frontmatter.date)} · {Math.ceil(featured.content.split(' ').length / 200)} min read
              </span>
            </div>

            <h2 style={{ font: '400 36px/1.22 var(--serif)', letterSpacing: 'var(--ls-tight)', color: 'var(--ink)', margin: 0 }}>
              <a href={`/blog/${featured.slug}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                {featured.frontmatter.titleAccent ? (
                  <>
                    {featured.frontmatter.title.split(featured.frontmatter.titleAccent)[0]}
                    <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>
                      {featured.frontmatter.titleAccent}
                    </em>
                    {featured.frontmatter.title.split(featured.frontmatter.titleAccent)[1]}
                  </>
                ) : featured.frontmatter.title}
              </a>
            </h2>

            <p style={{ font: '300 16px/1.65 var(--sans)', color: 'var(--ink-2)', margin: 0 }}>
              {featured.frontmatter.description}
            </p>

            <a
              href={`/blog/${featured.slug}`}
              className="read-link"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                font: 'var(--t-ui)', color: 'var(--ink)',
                paddingBottom: 4,
                borderBottom: '1px solid var(--ink)',
                alignSelf: 'flex-start',
                textDecoration: 'none',
              }}
            >
              Read the full guide
              <ArrowRight size={14} />
            </a>
          </div>
        </section>
      )}

      {/* ── Post list ─────────────────────────────────────────────── */}
      <div style={{
        ...W, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        borderTop: '1px solid var(--rule)',
        padding: '56px 5vw 12px',
        gap: 16, flexWrap: 'wrap',
      }}>
        <h3 style={{ font: '400 28px/1.15 var(--serif)', letterSpacing: 'var(--ls-tight)', color: 'var(--ink)', margin: 0 }}>
          Latest <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>posts</em>
        </h3>
        <span style={{ font: 'var(--t-body-sm)', color: 'var(--ink-3)' }}>
          {activeCategory === 'all' ? 'All articles' : tagLabel(activeCategory)} · sorted by date
        </span>
      </div>

      {filtered.length === 0 && (
        <p style={{ color: 'var(--ink-4)', padding: '24px 0' }}>No articles in this category yet.</p>
      )}

      <ul style={{ ...W, listStyle: 'none', padding: '0 5vw', margin: '0 auto' }}>
        {filtered.map((article) => (
          <li
            key={article.slug}
            style={{ borderTop: '1px solid var(--rule)' }}
          >
            <a
              href={`/blog/${article.slug}`}
              className="post-row"
              onMouseEnter={() => setHoveredSlug(article.slug)}
              onMouseLeave={() => setHoveredSlug(null)}
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 1fr 200px auto',
                gap: 28,
                alignItems: 'baseline',
                padding: hoveredSlug === article.slug ? '28px 16px' : '28px 4px',
                margin: hoveredSlug === article.slug ? '0 -16px' : '0',
                textDecoration: 'none',
                position: 'relative',
              }}
            >
              <span className="post-date" style={{ font: 'var(--t-ui-sm)', color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
                {formatDate(article.frontmatter.date)}
              </span>

              <div className="post-row-grid" style={{ minWidth: 0 }}>
                <h4
                  className="post-title"
                  style={{
                    font: '400 22px/1.25 var(--serif)',
                    letterSpacing: 'var(--ls-tight)',
                    color: hoveredSlug === article.slug ? 'var(--accent)' : 'var(--ink)',
                    margin: '0 0 6px',
                  }}
                >
                  {article.frontmatter.title}
                </h4>
                <p style={{ font: '300 14px/1.55 var(--sans)', color: 'var(--ink-3)', margin: 0, maxWidth: 460 }}>
                  {article.frontmatter.description}
                </p>
              </div>

              <span
                className="post-tag"
                style={{
                  font: 'var(--t-micro)', letterSpacing: 'var(--ls-eyebrow)',
                  textTransform: 'uppercase', color: 'var(--ink-3)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                {tagLabel(postCategory(article.frontmatter.tags))}
              </span>

              <span
                className="post-arrow post-arrow-col"
                style={{ color: hoveredSlug === article.slug ? 'var(--accent)' : 'var(--ink-4)', alignSelf: 'center' }}
              >
                <ArrowRight size={16} />
              </span>
            </a>
          </li>
        ))}
        {/* Bottom border on last item */}
        <li style={{ borderTop: '1px solid var(--rule)' }} />
      </ul>

      {/* ── Topics grid ───────────────────────────────────────────── */}
      <section style={{ ...W, padding: '80px 5vw', borderTop: '1px solid var(--rule)', marginTop: 64 }}>
        <div
          className="topics-title-row"
          style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 32, alignItems: 'start', marginBottom: 32 }}
        >
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, font: 'var(--t-micro)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 12 }}>
              <EyebrowDot />
              Browse
            </div>
            <h3 style={{ font: '400 28px/1.22 var(--serif)', letterSpacing: 'var(--ls-tight)', margin: 0 }}>
              By <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>topic.</em>
            </h3>
          </div>
          <p style={{ font: '300 15px/1.6 var(--sans)', color: 'var(--ink-3)', margin: 0 }}>
            Every guide is grouped by the operational job it`s helping you do — not by SEO keyword.
            Pick the part of your warehouse that`s leaking time.
          </p>
        </div>

        <div
          className="topic-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 1,
            background: 'var(--rule)',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--r-lg)',
            overflow: 'hidden',
          }}
        >
          {topics.map(([cat, count]) => (
            <div
              key={cat}
              className="topic-card"
              onClick={() => setActiveCategory(cat)}
              style={{
                background: 'var(--surface)',
                padding: '22px 24px',
                display: 'flex', flexDirection: 'column', gap: 6,
              }}
            >
              <div style={{ font: '500 14px/1.3 var(--sans)', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>{tagLabel(cat)}</span>
                <span style={{ font: '400 13px var(--serif)', color: 'var(--accent)', fontStyle: 'italic' }}>
                  {String(count).padStart(2, '0')}
                </span>
              </div>
              <p style={{ font: 'var(--t-body-sm)', color: 'var(--ink-3)', margin: 0 }}>
                {TOPIC_DESCRIPTIONS[cat] ?? `Guides covering ${tagLabel(cat).toLowerCase()} for Shopify merchants.`}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Newsletter CTA ────────────────────────────────────────── */}
      <section
        className="newsletter-grid"
        style={{
          ...W, marginBottom: 64,
          background: 'var(--space-1)',
          color: '#F0EEE8',
          borderRadius: 'var(--r-xl)',
          padding: '44px 48px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 40,
          alignItems: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Grid overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)
          `,
          backgroundSize: '28px 28px',
          WebkitMaskImage: 'radial-gradient(ellipse 60% 80% at 100% 50%, #000 15%, transparent 75%)',
          maskImage: 'radial-gradient(ellipse 60% 80% at 100% 50%, #000 15%, transparent 75%)',
          opacity: 0.8,
          pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--accent)', font: 'var(--t-micro)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', marginBottom: 12 }}>
            <EyebrowDot />
            Weekly · For operators
          </div>
          <h3 style={{ font: '400 28px/1.22 var(--serif)', letterSpacing: 'var(--ls-tight)', margin: '0 0 10px', color: '#F0EEE8' }}>
            The Morning Brief,{' '}
            <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>in your inbox.</em>
          </h3>
          <p style={{ margin: 0, font: '300 14.5px/1.6 var(--sans)', color: 'rgba(240,238,232,0.7)', maxWidth: 400 }}>
            One short letter a week. Operational patterns we keep seeing across the merchants we
            work with — and the fixes that actually held.
          </p>
        </div>

        <NewsletterForm />
      </section>
    </>
  )
}

// ── Newsletter form (isolated to manage its own state) ────────────────────────

function NewsletterForm() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div style={{ color: 'rgba(240,238,232,0.9)', font: '300 15px/1.6 var(--sans)', padding: '10px 0' }}>
        ✓ You`re subscribed. First issue lands next Monday.
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        position: 'relative',
        display: 'flex', gap: 10,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 'var(--r-md)',
        padding: 6,
      }}
    >
      <input
        type="email"
        required
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="your@shopify-store.com"
        style={{
          flex: 1, minWidth: 0,
          background: 'transparent',
          border: 'none',
          color: '#F0EEE8',
          padding: '10px 14px',
          font: '300 14px var(--sans)',
          outline: 'none',
        }}
      />
      <button
        type="submit"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '10px 18px', background: 'var(--accent)', color: '#fff',
          font: 'var(--t-ui)', borderRadius: 'var(--r-sm)', border: 'none',
          cursor: 'pointer',
        }}
      >
        Subscribe
        <ArrowRight size={14} />
      </button>
    </form>
  )
}