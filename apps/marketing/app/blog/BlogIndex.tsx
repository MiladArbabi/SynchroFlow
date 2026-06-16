// app/blog/BlogIndex.tsx
// Client component — receives pre-loaded articles from the server page.tsx.
// Handles filter tabs, hover states, newsletter form.
// IMPORTANT: No `font:` shorthand in inline styles — CSS custom properties do not resolve
// inside the font shorthand in inline React styles. Always use explicit fontFamily/fontSize/
// fontWeight/lineHeight properties instead.

'use client'

import { useState } from 'react'
import type { ContentItem, Frontmatter } from '@/lib/mdx'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

const TAG_LABELS: Record<string, string> = {
  shopify: 'Shopify', inventory: 'Inventory', sync: 'Sync',
  operations: 'Operations', suppliers: 'Suppliers', compare: 'Compare',
  wms: 'WMS', picking: 'Pick & Pack', receiving: 'Receiving',
  workforce: 'Workforce', returns: 'Returns',
}

function tagLabel(t: string): string {
  return TAG_LABELS[t] ?? t.charAt(0).toUpperCase() + t.slice(1)
}

function postCategory(tags: string[]): string {
  const CATS = ['inventory', 'operations', 'suppliers', 'compare', 'wms', 'receiving', 'workforce']
  return tags.find(t => CATS.includes(t)) ?? tags[0] ?? 'other'
}

function ArrowRight({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" /><path d="m13 6 6 6-6 6" />
    </svg>
  )
}

function EyebrowDot() {
  return (
    <span style={{
      width: 6, height: 6, borderRadius: '50%',
      background: '#FF6B2B',
      display: 'inline-block',
      animation: 'blink 2.4s ease-in-out infinite',
    }} />
  )
}

// FeaturedVisual — driven by the featured article's frontmatter.
// Never hardcode content here — this renders whatever article sorts first by date.
function FeaturedVisual({ frontmatter }: { frontmatter: Frontmatter }) {
  const category = postCategory(frontmatter.tags)
  const bullets = frontmatter.secondaryKeywords.slice(0, 3)

  return (
    <div style={{
      border: '1px solid #E8E6E0', borderRadius: 12, overflow: 'hidden',
      background: '#F3F2EF', aspectRatio: '5/4', position: 'relative',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse 70% 55% at 50% 40%, rgba(255,107,43,0.04), transparent 75%)',
      }} />
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `linear-gradient(#E8E6E0 1px, transparent 1px), linear-gradient(90deg, #E8E6E0 1px, transparent 1px)`,
        backgroundSize: '28px 28px',
        WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, #000 15%, transparent 75%)',
        maskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, #000 15%, transparent 75%)',
        opacity: 0.5, pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        justifyContent: 'center', padding: '36px 40px', gap: 18,
      }}>
        <span style={{
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 11,
          fontWeight: 500, letterSpacing: '0.12em',
          textTransform: 'uppercase' as const, color: '#FF6B2B',
        }}>
          {tagLabel(category)}
        </span>
        <h4 style={{
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          fontSize: 24, fontWeight: 400, lineHeight: 1.2,
          letterSpacing: '-0.02em', color: '#0F0E0D', margin: 0,
        }}>
          {frontmatter.primaryKeyword}
        </h4>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {bullets.map(kw => (
            <li key={kw} style={{
              fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
              fontSize: 13, fontWeight: 300, lineHeight: 1.4,
              color: '#3A3835', display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#FF6B2B', flexShrink: 0 }} />
              {kw}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// W: shared horizontal constraint — layout.tsx <main> provides only nav clearance
const W = { maxWidth: '1200px', margin: '0 auto', padding: '0 5vw' } as const

const TOPIC_DESCRIPTIONS: Record<string, string> = {
  inventory: 'Why your shelf and Shopify disagree — and how to close the gap permanently.',
  operations: '2 to 4 hours a week on data repair instead of growth. Here\'s the fix.',
  suppliers: 'Every PO is a rating. On-time, accuracy, and damage scores from your history.',
  compare: 'Cin7, Linnworks, ShipHero, Stocky — operator-honest comparisons.',
  wms: 'What warehouse management actually means for a Shopify SMB.',
  receiving: 'Scan-to-receive, discrepancy detection, supplier scorecards.',
  workforce: 'Scheduling, task assignment, and accountability — without enterprise complexity.',
  returns: 'Returns area inventory is invisible stock. How to fold it back in.',
}

export default function BlogIndex({ articles: allArticles }: { articles: ContentItem[] }) {
  const categories = Array.from(new Set(allArticles.map(a => postCategory(a.frontmatter.tags))))
  const [activeCategory, setActiveCategory] = useState('all')
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null)

  const featured = allArticles[0]
  const remaining = allArticles.slice(1)
  const filtered = activeCategory === 'all' ? remaining : remaining.filter(a => postCategory(a.frontmatter.tags) === activeCategory)

  const topicMap: Record<string, number> = {}
  for (const a of allArticles) {
    const cat = postCategory(a.frontmatter.tags)
    topicMap[cat] = (topicMap[cat] ?? 0) + 1
  }
  const topics = Object.entries(topicMap).sort((a, b) => b[1] - a[1])

  return (
    <>
      <style>{`
        @keyframes blink {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(.75); opacity: .4; }
        }
        .post-row { transition: padding .2s, background .15s; }
        .post-row:hover { background: #F3F2EF; border-radius: 8px; }
        .post-title { transition: color .15s; }
        .post-row:hover .post-title { color: #FF6B2B !important; }
        .post-arrow { transition: color .15s, transform .15s; }
        .post-row:hover .post-arrow { color: #FF6B2B !important; transform: translateX(4px); }
        .read-link { transition: color .15s, border-color .15s, gap .15s; }
        .read-link:hover { color: #FF6B2B !important; border-color: #FF6B2B !important; gap: 12px !important; }
        .filter-tab { transition: all .15s; cursor: pointer; }
        .topic-card { transition: background .15s; cursor: pointer; }
        .topic-card:hover { background: #F3F2EF !important; }
        a { color: inherit; text-decoration: none; }
        @media (max-width: 880px) {
          .post-row-grid { grid-template-columns: 1fr !important; gap: 8px !important; }
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
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#FF6B2B', marginBottom: 22, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          <EyebrowDot />
          The operator&apos;s library
        </div>
        <h1 className="page-h1" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 64, fontWeight: 400, lineHeight: 1.18, letterSpacing: '-0.02em', color: '#0F0E0D', margin: '0 0 32px', maxWidth: 820 }}>
          Operational intelligence for merchants who{' '}
          <em style={{ color: '#FF6B2B', fontStyle: 'italic' }}>run their own warehouse.</em>
        </h1>
        <p style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 18, fontWeight: 300, lineHeight: 1.55, color: '#3A3835', maxWidth: 560, margin: 0 }}>
          Guides, post-mortems, and field notes for Shopify operators stuck between
          spreadsheets and enterprise systems they don&apos;t need.
        </p>
      </header>

      {/* ── Filter strip ──────────────────────────────────────────── */}
      <div style={{ ...W, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '18px 5vw', borderTop: '1px solid #E8E6E0', borderBottom: '1px solid #E8E6E0', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {['all', ...categories].map(cat => (
            <button key={cat} className="filter-tab" onClick={() => setActiveCategory(cat)} style={{
              padding: '8px 14px',
              fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 500,
              color: activeCategory === cat ? '#FF6B2B' : '#6B7280',
              borderRadius: 100, border: activeCategory === cat ? '1px solid #FFDCCA' : '1px solid transparent',
              background: activeCategory === cat ? '#FFF0E8' : 'transparent', cursor: 'pointer',
            }}>
              {cat === 'all' ? 'All' : tagLabel(cat)}
            </button>
          ))}
        </div>
        <div style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 13, fontWeight: 400, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 16, color: '#0F0E0D', fontStyle: 'italic' }}>
            {allArticles.length}
          </span>
          articles published
        </div>
      </div>

      {/* ── Featured article ──────────────────────────────────────── */}
      {featured && (
        <section className="featured-grid" style={{ ...W, padding: '56px 5vw 32px', display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: 56, alignItems: 'stretch' }}>
          <a href={`/blog/${featured.slug}`} aria-label="Featured article" style={{ display: 'block' }}>
            <FeaturedVisual frontmatter={featured.frontmatter} />
          </a>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                padding: '5px 12px', background: '#FFFFFF',
                border: '1px solid #FFDCCA', borderRadius: 100,
                fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 11, fontWeight: 500,
                letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#FF6B2B',
              }}>
                Featured · This week
              </span>
              <span style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 300, color: '#6B7280' }}>
                {formatDate(featured.frontmatter.date)} · {Math.ceil((featured.content?.split(' ').length ?? 0) / 200)} min read
              </span>
            </div>
            <h2 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 36, fontWeight: 400, lineHeight: 1.22, letterSpacing: '-0.02em', color: '#0F0E0D', margin: 0 }}>
              <a href={`/blog/${featured.slug}`}>
                {featured.frontmatter.titleAccent ? (
                  <>
                    {featured.frontmatter.title}{' '}
                    <em style={{ color: '#FF6B2B', fontStyle: 'italic' }}>{featured.frontmatter.titleAccent}</em>
                  </>
                ) : featured.frontmatter.title}
              </a>
            </h2>
            <p style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 16, fontWeight: 300, lineHeight: 1.65, color: '#3A3835', margin: 0 }}>
              {featured.frontmatter.description}
            </p>
            <a href={`/blog/${featured.slug}`} className="read-link" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 500,
              color: '#0F0E0D', paddingBottom: 4, borderBottom: '1px solid #0F0E0D',
              alignSelf: 'flex-start',
            }}>
              Read the full guide
              <ArrowRight size={14} />
            </a>
          </div>
        </section>
      )}

      {/* ── Post list header ──────────────────────────────────────── */}
      <div style={{ ...W, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderTop: '1px solid #E8E6E0', padding: '56px 5vw 12px', gap: 16, flexWrap: 'wrap' }}>
        <h3 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 28, fontWeight: 400, lineHeight: 1.15, letterSpacing: '-0.02em', color: '#0F0E0D', margin: 0 }}>
          Latest <em style={{ color: '#FF6B2B', fontStyle: 'italic' }}>posts</em>
        </h3>
        <span style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 300, color: '#6B7280' }}>
          Sorted by published date
        </span>
      </div>

      {/* ── Post list ─────────────────────────────────────────────── */}
      {filtered.length === 0 && (
        <p style={{ ...W, padding: '24px 5vw', color: '#9CA3AF' }}>No articles in this category yet.</p>
      )}
      <ul style={{ ...W, listStyle: 'none', padding: '0 5vw', margin: '0 auto' }}>
        {filtered.map((article) => (
          <li key={article.slug} style={{ borderTop: '1px solid #E8E6E0' }}>
            <a href={`/blog/${article.slug}`} className="post-row"
              onMouseEnter={() => setHoveredSlug(article.slug)}
              onMouseLeave={() => setHoveredSlug(null)}
              style={{
                display: 'grid', gridTemplateColumns: '120px 1fr 180px auto',
                gap: 28, alignItems: 'baseline',
                padding: hoveredSlug === article.slug ? '28px 16px' : '28px 4px',
                margin: hoveredSlug === article.slug ? '0 -16px' : '0',
              }}>
              <span style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 13, fontWeight: 400, color: '#6B7280', letterSpacing: '0.04em' }}>
                {formatDate(article.frontmatter.date)}
              </span>
              <div className="post-row-grid" style={{ minWidth: 0 }}>
                <h4 className="post-title" style={{
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 22, fontWeight: 400,
                  lineHeight: 1.25, letterSpacing: '-0.02em',
                  color: hoveredSlug === article.slug ? '#FF6B2B' : '#0F0E0D',
                  margin: '0 0 6px',
                }}>
                  {article.frontmatter.title}
                </h4>
                <p style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 300, lineHeight: 1.55, color: '#6B7280', margin: 0, maxWidth: 460 }}>
                  {article.frontmatter.description}
                </p>
              </div>
              <span style={{
                fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 11, fontWeight: 500,
                letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#6B7280',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#FF6B2B', flexShrink: 0 }} />
                {tagLabel(postCategory(article.frontmatter.tags))}
              </span>
              <span className="post-arrow post-arrow-col" style={{ color: hoveredSlug === article.slug ? '#FF6B2B' : '#9CA3AF', alignSelf: 'center' }}>
                <ArrowRight size={16} />
              </span>
            </a>
          </li>
        ))}
        <li style={{ borderTop: '1px solid #E8E6E0' }} />
      </ul>

      {/* ── Topics grid ───────────────────────────────────────────── */}
      <section style={{ ...W, padding: '80px 5vw', borderTop: '1px solid #E8E6E0', marginTop: 64 }}>
        <div className="topics-title-row" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 32, alignItems: 'start', marginBottom: 32 }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#FF6B2B', marginBottom: 12, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              <EyebrowDot />
              Browse
            </div>
            <h3 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 28, fontWeight: 400, lineHeight: 1.22, letterSpacing: '-0.02em', margin: 0 }}>
              By <em style={{ color: '#FF6B2B', fontStyle: 'italic' }}>topic.</em>
            </h3>
          </div>
          <p style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 15, fontWeight: 300, lineHeight: 1.6, color: '#6B7280', margin: 0 }}>
            Every guide is grouped by the operational job it&apos;s helping you do — not by SEO keyword.
            Pick the part of your warehouse that&apos;s leaking time.
          </p>
        </div>
        <div className="topic-grid" style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 1, background: '#E8E6E0',
          border: '1px solid #E8E6E0', borderRadius: 12, overflow: 'hidden',
        }}>
          {topics.map(([cat, count]) => (
            <div key={cat} className="topic-card" onClick={() => setActiveCategory(cat)} style={{
              background: '#FFFFFF', padding: '22px 24px',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 500, lineHeight: 1.3, color: '#0F0E0D', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>{tagLabel(cat)}</span>
                <span style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 13, color: '#FF6B2B', fontStyle: 'italic' }}>
                  {String(count).padStart(2, '0')}
                </span>
              </div>
              <p style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 300, lineHeight: 1.55, color: '#6B7280', margin: 0 }}>
                {TOPIC_DESCRIPTIONS[cat] ?? `Guides covering ${tagLabel(cat).toLowerCase()} for Shopify merchants.`}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Newsletter CTA ────────────────────────────────────────── */}
      <section className="newsletter-grid" style={{
        ...W, marginBottom: 64,
        background: '#151D29', color: '#F0EEE8',
        borderRadius: 14, padding: '44px 48px',
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 40, alignItems: 'center',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)`,
          backgroundSize: '28px 28px',
          WebkitMaskImage: 'radial-gradient(ellipse 60% 80% at 100% 50%, #000 15%, transparent 75%)',
          maskImage: 'radial-gradient(ellipse 60% 80% at 100% 50%, #000 15%, transparent 75%)',
          opacity: 0.8, pointerEvents: 'none',
        }} />
        <div style={{ position: 'relative', margin: 12 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#FF6B2B', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>
            <EyebrowDot />
            Weekly · For operators
          </div>
          <h3 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 28, fontWeight: 400, lineHeight: 1.22, letterSpacing: '-0.02em', margin: '0 0 10px', color: '#F0EEE8' }}>
            The Morning Brief,{' '}
            <em style={{ color: '#FF6B2B', fontStyle: 'italic' }}>in your inbox.</em>
          </h3>
          <p style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 14.5, fontWeight: 300, lineHeight: 1.6, color: 'rgba(240,238,232,0.7)', maxWidth: 400 }}>
            One short letter a week. Operational patterns we keep seeing across the merchants we
            work with — and the fixes that actually held.
          </p>
        </div>
        <NewsletterForm />
      </section>
    </>
  )
}

function NewsletterForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email || status === 'loading') return
    setStatus('loading')
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // source: 'newsletter' distinguishes Morning Brief signups from waitlist signups in DB
        body: JSON.stringify({ email, source: 'newsletter' }),
      })
      setStatus(res.ok ? 'success' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div style={{ color: 'rgba(240,238,232,0.9)', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 15, fontWeight: 300, lineHeight: 1.6, padding: '10px 0' }}>
        ✓ You&apos;re subscribed. First issue lands next Monday.
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{
      position: 'relative', display: 'flex', gap: 10,
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 8, padding: 6,
    }}>
      <input
        type="email" required value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="your@shopify-store.com"
        disabled={status === 'loading'}
        style={{
          flex: 1, minWidth: 0, background: 'transparent', border: 'none',
          color: '#F0EEE8', padding: '10px 14px',
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 300,
          outline: 'none', opacity: status === 'loading' ? 0.6 : 1,
        }}
      />
      <button type="submit" disabled={status === 'loading'} style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '10px 18px', background: '#FF6B2B', color: '#fff',
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 14, fontWeight: 500,
        borderRadius: 6, border: 'none', cursor: status === 'loading' ? 'wait' : 'pointer',
        opacity: status === 'loading' ? 0.7 : 1,
      }}>
        {status === 'loading' ? 'Subscribing…' : 'Subscribe'}
        {status !== 'loading' && <ArrowRight size={14} />}
      </button>
      {status === 'error' && (
        <p style={{ position: 'absolute', bottom: '-24px', left: 0, margin: 0, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 12, color: '#FF6B2B' }}>
          Something went wrong — please try again.
        </p>
      )}
    </form>
  )
}