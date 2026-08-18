// app/blog/BlogIndex.tsx
// Client component: receives pre-loaded articles from the server page.tsx.
// Handles filter tabs, hover states, topic cards, and the newsletter form.

'use client'

import { useState } from 'react'
import {
  ContentHero,
  ContentMeta,
  ContentShell,
} from '@/components/content'
import type { ContentItem, Frontmatter } from '@/lib/mdx'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

const TAG_LABELS: Record<string, string> = {
  shopify: 'Shopify',
  inventory: 'Inventory',
  sync: 'Sync',
  operations: 'Operations',
  suppliers: 'Suppliers',
  compare: 'Compare',
  wms: 'WMS',
  picking: 'Pick & Pack',
  receiving: 'Receiving',
  workforce: 'Workforce',
  returns: 'Returns',
}

function tagLabel(t: string): string {
  return TAG_LABELS[t] ?? t.charAt(0).toUpperCase() + t.slice(1)
}

function postCategory(tags: string[]): string {
  const CATS = ['inventory', 'operations', 'suppliers', 'compare', 'wms', 'receiving', 'workforce']
  return tags.find((t) => CATS.includes(t)) ?? tags[0] ?? 'other'
}

function ArrowRight({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  )
}

// FeaturedVisual is driven by the featured article's frontmatter.
function FeaturedVisual({ frontmatter }: { frontmatter: Frontmatter }) {
  const category = postCategory(frontmatter.tags)
  const bullets = frontmatter.secondaryKeywords.slice(0, 3)

  return (
    <div style={{
      border: '1px solid var(--rule)',
      borderRadius: 'var(--r-lg)',
      overflow: 'hidden',
      background: 'var(--surface)',
      aspectRatio: '5/4',
      position: 'relative',
    }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(ellipse 70% 55% at 50% 40%, var(--accent-ghost), transparent 75%)',
      }} />
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'linear-gradient(var(--rule) 1px, transparent 1px), linear-gradient(90deg, var(--rule) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
        WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, #000 15%, transparent 75%)',
        maskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, #000 15%, transparent 75%)',
        opacity: 0.8,
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '36px 40px',
        gap: 18,
      }}>
        <span style={{
          fontFamily: 'var(--sans)',
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: 'var(--ls-eyebrow)',
          textTransform: 'uppercase',
          color: 'var(--accent)',
        }}>
          {tagLabel(category)}
        </span>
        <h4 style={{
          fontFamily: 'var(--sans)',
          fontSize: 24,
          fontWeight: 400,
          lineHeight: 1.2,
          letterSpacing: 'var(--ls-tight)',
          color: 'var(--ink)',
          margin: 0,
        }}>
          {frontmatter.primaryKeyword}
        </h4>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {bullets.map((kw) => (
            <li key={kw} style={{
              fontFamily: 'var(--sans)',
              fontSize: 13,
              fontWeight: 300,
              lineHeight: 1.4,
              color: 'var(--ink-2)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <span style={{ width: 4, height: 4, borderRadius: 'var(--r-pill)', background: 'var(--accent)', flexShrink: 0 }} />
              {kw}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const TOPIC_DESCRIPTIONS: Record<string, string> = {
  inventory: 'Why your shelf and Shopify disagree — and how to close the gap permanently.',
  operations: '2 to 4 hours a week on data repair instead of growth. Here is the fix.',
  suppliers: 'Every PO is a rating. On-time, accuracy, and damage scores from your history.',
  compare: 'Cin7, Linnworks, ShipHero, Stocky — operator-honest comparisons.',
  wms: 'What warehouse management actually means for a Shopify SMB.',
  receiving: 'Scan-to-receive, discrepancy detection, supplier scorecards.',
  workforce: 'Scheduling, task assignment, and accountability — without enterprise complexity.',
  returns: 'Returns area inventory is invisible stock. How to fold it back in.',
}

export default function BlogIndex({ articles: allArticles }: { articles: ContentItem[] }) {
  const categories = Array.from(new Set(allArticles.map((a) => postCategory(a.frontmatter.tags))))
  const [activeCategory, setActiveCategory] = useState('all')
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null)

  const featured = allArticles[0]
  const remaining = allArticles.slice(1)
  const filtered = activeCategory === 'all'
    ? remaining
    : remaining.filter((a) => postCategory(a.frontmatter.tags) === activeCategory)

  const topicMap: Record<string, number> = {}
  for (const a of allArticles) {
    const cat = postCategory(a.frontmatter.tags)
    topicMap[cat] = (topicMap[cat] ?? 0) + 1
  }
  const topics = Object.entries(topicMap).sort((a, b) => b[1] - a[1])

  return (
    <>
      <style>{`
        @keyframes blog-blink {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(.75); opacity: .4; }
        }
        .blog-index a { color: inherit; text-decoration: none; }
        .blog-post-row { transition: padding .2s, background .15s; }
        .blog-post-row:hover { background: var(--bg-2); border-radius: var(--r-md); }
        .blog-post-title { transition: color .15s; }
        .blog-post-row:hover .blog-post-title { color: var(--accent) !important; }
        .blog-post-arrow { transition: color .15s, transform .15s; }
        .blog-post-row:hover .blog-post-arrow { color: var(--accent) !important; transform: translateX(4px); }
        .blog-read-link { transition: color .15s, border-color .15s, gap .15s; }
        .blog-read-link:hover { color: var(--accent) !important; border-color: var(--accent) !important; gap: 12px !important; }
        .blog-filter-tab { transition: color .15s, border-color .15s, background .15s; cursor: pointer; }
        .blog-topic-card { transition: background .15s, border-color .15s; cursor: pointer; }
        .blog-topic-card:hover { background: var(--bg-2) !important; border-color: var(--accent-border) !important; }
        .blog-eyebrow-dot {
          width: 6px;
          height: 6px;
          border-radius: var(--r-pill);
          background: var(--accent);
          display: inline-block;
          animation: blog-blink 2.4s ease-in-out infinite;
        }
        @media (max-width: 880px) {
          .blog-post-row-grid { grid-template-columns: 1fr !important; gap: 8px !important; }
          .blog-post-arrow-col { display: none !important; }
        }
        @media (max-width: 720px) {
          .blog-featured-grid { grid-template-columns: 1fr !important; gap: 28px !important; }
          .blog-newsletter-grid { grid-template-columns: 1fr !important; padding: 28px !important; }
          .blog-topic-grid { grid-template-columns: 1fr !important; }
          .blog-topics-title-row { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div className="blog-index" style={{ paddingBottom: 64 }}>
        <ContentShell width="wide">
          <ContentHero
            eyebrow="The operator's library"
            title="Operational intelligence for merchants who"
            accentText="run their own warehouse."
            description="Guides, post-mortems, and field notes for Shopify operators stuck between spreadsheets and enterprise systems they don't need."
            trailing={
              <ContentMeta
                items={[{
                  value: `${allArticles.length} articles published`,
                }]}
              />
            }
          />
        </ContentShell>

        <ContentShell width="wide">
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 24,
            padding: '18px 0',
            borderTop: '1px solid var(--rule)',
            borderBottom: '1px solid var(--rule)',
            flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {['all', ...categories].map((cat) => {
                const active = activeCategory === cat
                return (
                  <button
                    key={cat}
                    className="blog-filter-tab"
                    onClick={() => setActiveCategory(cat)}
                    style={{
                      padding: '8px 14px',
                      fontFamily: 'var(--sans)',
                      fontSize: 14,
                      fontWeight: 500,
                      color: active ? 'var(--accent)' : 'var(--ink-3)',
                      borderRadius: 'var(--r-pill)',
                      border: active ? '1px solid var(--accent-border)' : '1px solid transparent',
                      background: active ? 'var(--accent-ghost)' : 'transparent',
                    }}
                  >
                    {cat === 'all' ? 'All' : tagLabel(cat)}
                  </button>
                )
              })}
            </div>
            <ContentMeta
              items={[{
                value: (
                  <>
                    <span style={{ color: 'var(--ink)', fontStyle: 'italic' }}>{allArticles.length}</span>
                    {' '}articles published
                  </>
                ),
              }]}
            />
          </div>
        </ContentShell>

        {featured && (
          <ContentShell width="wide">
            <section className="blog-featured-grid" style={{
              padding: '56px 0 32px',
              display: 'grid',
              gridTemplateColumns: '1.05fr 1fr',
              gap: 56,
              alignItems: 'stretch',
            }}>
              <a href={`/blog/${featured.slug}`} aria-label="Featured article" style={{ display: 'block' }}>
                <FeaturedVisual frontmatter={featured.frontmatter} />
              </a>
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{
                    padding: '5px 12px',
                    background: 'var(--accent-ghost)',
                    border: '1px solid var(--accent-border)',
                    borderRadius: 'var(--r-pill)',
                    fontFamily: 'var(--sans)',
                    fontSize: 11,
                    fontWeight: 500,
                    letterSpacing: 'var(--ls-eyebrow)',
                    textTransform: 'uppercase',
                    color: 'var(--accent)',
                  }}>
                    Featured · This week
                  </span>
                  <ContentMeta
                    items={[{
                      value: `${formatDate(featured.frontmatter.date)} · ${Math.ceil((featured.content?.split(' ').length ?? 0) / 200)} min read`,
                    }]}
                  />
                </div>
                <h2 style={{
                  fontFamily: 'var(--sans)',
                  fontSize: 36,
                  fontWeight: 400,
                  lineHeight: 1.22,
                  letterSpacing: 'var(--ls-tight)',
                  color: 'var(--ink)',
                  margin: 0,
                }}>
                  <a href={`/blog/${featured.slug}`}>
                    {featured.frontmatter.titleAccent ? (
                      <>
                        {featured.frontmatter.title}{' '}
                        <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>{featured.frontmatter.titleAccent}</em>
                      </>
                    ) : featured.frontmatter.title}
                  </a>
                </h2>
                <p style={{
                  fontFamily: 'var(--sans)',
                  fontSize: 16,
                  fontWeight: 300,
                  lineHeight: 1.65,
                  color: 'var(--ink-2)',
                  margin: 0,
                }}>
                  {featured.frontmatter.description}
                </p>
                <a href={`/blog/${featured.slug}`} className="blog-read-link" style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontFamily: 'var(--sans)',
                  fontSize: 14,
                  fontWeight: 500,
                  color: 'var(--ink)',
                  paddingBottom: 4,
                  borderBottom: '1px solid var(--rule-2)',
                  alignSelf: 'flex-start',
                }}>
                  Read the full guide
                  <ArrowRight size={14} />
                </a>
              </div>
            </section>
          </ContentShell>
        )}

        <ContentShell width="wide">
          <div style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            borderTop: '1px solid var(--rule)',
            padding: '56px 0 12px',
            gap: 16,
            flexWrap: 'wrap',
          }}>
            <h3 style={{
              fontFamily: 'var(--sans)',
              fontSize: 28,
              fontWeight: 400,
              lineHeight: 1.15,
              letterSpacing: 'var(--ls-tight)',
              color: 'var(--ink)',
              margin: 0,
            }}>
              Latest <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>posts</em>
            </h3>
            <span style={{ fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 300, color: 'var(--ink-3)' }}>
              Sorted by published date
            </span>
          </div>
        </ContentShell>

        <ContentShell width="wide">
          {filtered.length === 0 && (
            <p style={{ padding: '24px 0', color: 'var(--ink-4)' }}>No articles in this category yet.</p>
          )}
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 auto' }}>
            {filtered.map((article) => {
              const hovered = hoveredSlug === article.slug
              return (
                <li key={article.slug} style={{ borderTop: '1px solid var(--rule)' }}>
                  <a
                    href={`/blog/${article.slug}`}
                    className="blog-post-row"
                    onMouseEnter={() => setHoveredSlug(article.slug)}
                    onMouseLeave={() => setHoveredSlug(null)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '120px 1fr 180px auto',
                      gap: 28,
                      alignItems: 'baseline',
                      padding: hovered ? '28px 16px' : '28px 4px',
                      margin: hovered ? '0 -16px' : '0',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--sans)', fontSize: 13, fontWeight: 400, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
                      {formatDate(article.frontmatter.date)}
                    </span>
                    <div className="blog-post-row-grid" style={{ minWidth: 0 }}>
                      <h4 className="blog-post-title" style={{
                        fontFamily: 'var(--sans)',
                        fontSize: 22,
                        fontWeight: 400,
                        lineHeight: 1.25,
                        letterSpacing: 'var(--ls-tight)',
                        color: hovered ? 'var(--accent)' : 'var(--ink)',
                        margin: '0 0 6px',
                      }}>
                        {article.frontmatter.title}
                      </h4>
                      <p style={{
                        fontFamily: 'var(--sans)',
                        fontSize: 14,
                        fontWeight: 300,
                        lineHeight: 1.55,
                        color: 'var(--ink-3)',
                        margin: 0,
                        maxWidth: 460,
                      }}>
                        {article.frontmatter.description}
                      </p>
                    </div>
                    <span style={{
                      fontFamily: 'var(--sans)',
                      fontSize: 11,
                      fontWeight: 500,
                      letterSpacing: 'var(--ls-eyebrow)',
                      textTransform: 'uppercase',
                      color: 'var(--ink-3)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}>
                      <span style={{ width: 4, height: 4, borderRadius: 'var(--r-pill)', background: 'var(--accent)', flexShrink: 0 }} />
                      {tagLabel(postCategory(article.frontmatter.tags))}
                    </span>
                    <span className="blog-post-arrow blog-post-arrow-col" style={{ color: hovered ? 'var(--accent)' : 'var(--ink-4)', alignSelf: 'center' }}>
                      <ArrowRight size={16} />
                    </span>
                  </a>
                </li>
              )
            })}
            <li style={{ borderTop: '1px solid var(--rule)' }} />
          </ul>
        </ContentShell>

        <ContentShell width="wide">
          <section style={{ padding: '80px 0', borderTop: '1px solid var(--rule)', marginTop: 64 }}>
            <div className="blog-topics-title-row" style={{
              display: 'grid',
              gridTemplateColumns: '1fr 2fr',
              gap: 32,
              alignItems: 'start',
              marginBottom: 32,
            }}>
              <div>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  color: 'var(--accent)',
                  marginBottom: 12,
                  fontFamily: 'var(--sans)',
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: 'var(--ls-eyebrow)',
                  textTransform: 'uppercase',
                }}>
                  <span className="blog-eyebrow-dot" aria-hidden="true" />
                  Browse
                </div>
                <h3 style={{ fontFamily: 'var(--sans)', fontSize: 28, fontWeight: 400, lineHeight: 1.22, letterSpacing: 'var(--ls-tight)', margin: 0, color: 'var(--ink)' }}>
                  By <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>topic.</em>
                </h3>
              </div>
              <p style={{ fontFamily: 'var(--sans)', fontSize: 15, fontWeight: 300, lineHeight: 1.6, color: 'var(--ink-3)', margin: 0 }}>
                Every guide is grouped by the operational job it&apos;s helping you do — not by SEO keyword.
                Pick the part of your warehouse that&apos;s leaking time.
              </p>
            </div>
            <div className="blog-topic-grid" style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
            }}>
              {topics.map(([cat, count]) => (
                <button
                  key={cat}
                  type="button"
                  className="blog-topic-card"
                  onClick={() => setActiveCategory(cat)}
                  style={{
                    border: '1px solid var(--rule)',
                    borderRadius: 'var(--r-lg)',
                    background: 'var(--surface)',
                    padding: '22px 24px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    textAlign: 'left',
                    color: 'inherit',
                  }}
                >
                  <div style={{
                    fontFamily: 'var(--sans)',
                    fontSize: 14,
                    fontWeight: 500,
                    lineHeight: 1.3,
                    color: 'var(--ink)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                  }}>
                    <span>{tagLabel(cat)}</span>
                    <span style={{ fontFamily: 'var(--sans)', fontSize: 13, color: 'var(--accent)', fontStyle: 'italic' }}>
                      {String(count).padStart(2, '0')}
                    </span>
                  </div>
                  <p style={{ fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 300, lineHeight: 1.55, color: 'var(--ink-3)', margin: 0 }}>
                    {TOPIC_DESCRIPTIONS[cat] ?? `Guides covering ${tagLabel(cat).toLowerCase()} for Shopify merchants.`}
                  </p>
                </button>
              ))}
            </div>
          </section>
        </ContentShell>

        <ContentShell width="wide">
          <section className="blog-newsletter-grid" style={{
            background: 'var(--bg-2)',
            color: 'var(--ink)',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--r-xl)',
            padding: '44px 48px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 40,
            alignItems: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: 'linear-gradient(var(--rule) 1px, transparent 1px), linear-gradient(90deg, var(--rule) 1px, transparent 1px)',
              backgroundSize: '28px 28px',
              WebkitMaskImage: 'radial-gradient(ellipse 60% 80% at 100% 50%, #000 15%, transparent 75%)',
              maskImage: 'radial-gradient(ellipse 60% 80% at 100% 50%, #000 15%, transparent 75%)',
              opacity: 0.8,
              pointerEvents: 'none',
            }} />
            <div style={{ position: 'relative', margin: 12 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--accent)', fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 500, letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', marginBottom: 12 }}>
                <span className="blog-eyebrow-dot" aria-hidden="true" />
                Weekly · For operators
              </div>
              <h3 style={{ fontFamily: 'var(--sans)', fontSize: 28, fontWeight: 400, lineHeight: 1.22, letterSpacing: 'var(--ls-tight)', margin: '0 0 10px', color: 'var(--ink)' }}>
                The Morning Brief,{' '}
                <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>in your inbox.</em>
              </h3>
              <p style={{ margin: 0, fontFamily: 'var(--sans)', fontSize: 14.5, fontWeight: 300, lineHeight: 1.6, color: 'var(--ink-2)', maxWidth: 400 }}>
                One short letter a week. Operational patterns we keep seeing across the merchants we
                work with — and the fixes that actually held.
              </p>
            </div>
            <NewsletterForm />
          </section>
        </ContentShell>
      </div>
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
        body: JSON.stringify({ email, source: 'newsletter' }),
      })
      setStatus(res.ok ? 'success' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div style={{ color: 'var(--ink)', fontFamily: 'var(--sans)', fontSize: 15, fontWeight: 300, lineHeight: 1.6, padding: '10px 0' }}>
        ✓ You&apos;re subscribed. First issue lands next Monday.
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{
      position: 'relative',
      display: 'flex',
      gap: 10,
      background: 'var(--bg-3)',
      border: '1px solid var(--rule-2)',
      borderRadius: 'var(--r-md)',
      padding: 6,
    }}>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@shopify-store.com"
        disabled={status === 'loading'}
        style={{
          flex: 1,
          minWidth: 0,
          background: 'transparent',
          border: 'none',
          color: 'var(--ink)',
          padding: '10px 14px',
          fontFamily: 'var(--sans)',
          fontSize: 14,
          fontWeight: 300,
          outline: 'none',
          opacity: status === 'loading' ? 0.6 : 1,
        }}
      />
      <button
        type="submit"
        disabled={status === 'loading'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 18px',
          background: 'var(--accent)',
          color: 'var(--on-accent)',
          fontFamily: 'var(--sans)',
          fontSize: 14,
          fontWeight: 500,
          borderRadius: 'var(--r-sm)',
          border: 'none',
          cursor: status === 'loading' ? 'wait' : 'pointer',
          opacity: status === 'loading' ? 0.7 : 1,
        }}
      >
        {status === 'loading' ? 'Subscribing…' : 'Subscribe'}
        {status !== 'loading' && <ArrowRight size={14} />}
      </button>
      {status === 'error' && (
        <p style={{ position: 'absolute', bottom: '-24px', left: 0, margin: 0, fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--accent)' }}>
          Something went wrong — please try again.
        </p>
      )}
    </form>
  )
}
