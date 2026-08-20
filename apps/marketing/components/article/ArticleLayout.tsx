// components/article/ArticleLayout.tsx
// Full article layout matching the redesigned blog post template.
// Used by blog, compare, features, and industries routes.

import { Frontmatter } from '@/lib/mdx'
import FAQ from './FAQ'
import InternalLinks from './InternalLinks'
import ArticleCTA from './ArticleCTA'
import Link from 'next/link'

interface ArticleLayoutProps {
  frontmatter: Frontmatter
  children: React.ReactNode
  relatedLinks?: { href: string; title: string; description?: string }[]
  // wordCount: raw body word count passed from page.tsx — used for accurate read time
  wordCount: number
  // basePath: controls breadcrumb root — 'blog' | 'compare' | 'industries' | 'features'
  basePath?: { href: string; label: string }
  variant?: 'legacy' | 'dark'
}

export default function ArticleLayout({ 
  frontmatter, 
  children, 
  relatedLinks = [], 
  wordCount, 
  basePath = { href: '/blog', label: 'Blog' },
  variant = 'legacy',
}: ArticleLayoutProps) {
  // 200 wpm average reading speed; minimum 1 min
  const readTime = Math.max(1, Math.ceil(wordCount / 200))
  const isDark = variant === 'dark'
  const sans = isDark ? 'var(--sans)' : "'DM Sans', system-ui, sans-serif"
  const headingSans = isDark ? 'var(--sans)' : "'Plus Jakarta Sans', system-ui, sans-serif"
  const primary = isDark ? 'var(--ink)' : '#0F0E0D'
  const secondary = isDark ? 'var(--ink-2)' : '#3A3835'
  const muted = isDark ? 'var(--ink-3)' : '#6B7280'
  const faint = isDark ? 'var(--ink-4)' : '#9CA3AF'
  const accent = isDark ? 'var(--accent)' : '#FF6B2B'
  const rule = isDark ? 'var(--rule)' : '#E8E6E0'

  return (
    <>
      {/* Article header */}
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 5vw' }}>
        <header style={{ padding: '72px 0 32px', borderBottom: '1px solid var(--rule)' }}>
          {/* Breadcrumbs */}
          <div style={{
            fontFamily: sans,
            fontSize: '11px', fontWeight: 500,
            letterSpacing: '0.12em', textTransform: 'uppercase',
            color: muted, marginBottom: '28px',
            display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            <Link href={basePath.href} style={{ color: muted, textDecoration: 'none', borderBottom: 'none' }}>{basePath.label}</Link>            <span style={{ color: faint }}>·</span>
            <span style={{ color: accent }}>{frontmatter.tags?.[0]}</span>
            <span style={{ color: faint }}>·</span>
            <span>{readTime} min read</span>
          </div>

          {/* Title */}
          <h1 style={{
            fontFamily: headingSans,
            fontSize: 'clamp(36px, 5vw, 56px)',
            fontWeight: 400,
            lineHeight: 1.2,
            letterSpacing: '-0.02em',
            color: primary,
            margin: '0 0 32px',
          }}>
            {frontmatter.titleAccent ? (
              <>
                {frontmatter.title}{' '}
                <em style={{ color: accent, fontStyle: 'italic' }}>{frontmatter.titleAccent}</em>
              </>
            ) : frontmatter.title}
          </h1>

          {/* Deck / description */}
          <p style={{
            fontFamily: sans,
            fontSize: '19px', fontWeight: 300,
            lineHeight: 1.55, color: secondary,
            margin: '0 0 36px',
          }}>
            {frontmatter.description}
          </p>

          {/* Meta row */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px',
            fontFamily: sans,
            fontSize: '12px', fontWeight: 500, color: muted,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: secondary }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/favicon-dark.svg" alt="" width={20} height={20} style={{ borderRadius: '4px', display: 'block' }} />
              <span>LaSyncro</span>
            </div>
            <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: faint }} />
            <span>{new Date(frontmatter.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
            {frontmatter.lastReviewed !== frontmatter.date && (
              <>
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: faint }} />
                <span>Last reviewed {new Date(frontmatter.lastReviewed).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              </>
            )}
            {frontmatter.tags?.length > 0 && (
              <>
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: faint }} />
                <span>{frontmatter.tags.join(' · ')}</span>
              </>
            )}
          </div>
         </header>

        {/* Faded divider between header and hero visual */}
        <div style={{
          height: '1px',
          background: `linear-gradient(90deg, transparent, ${rule} 20%, ${rule} 80%, transparent)`,
          margin: '0',
        }} />
      </div>

      {/* Article body */}
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 5vw' }}>
        <article style={{ marginTop: '12px',padding: '12px 0 32px' }}>
          {children}
          {/* Use article-specific CTA destinations and labels so SEO pages can match conversion intent. */}
          <ArticleCTA variant="inline" theme={variant} text={frontmatter.cta_text} href={frontmatter.cta_url} label={frontmatter.cta_label} />
        </article>
      </div>

      {/* Divider before FAQ */}
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 5vw' }}>
        <div style={{ height: '1px', background: `linear-gradient(90deg, transparent, ${rule} 20%, ${rule} 80%, transparent)`, margin: '0 0 48px' }} />
      </div>

      {/* FAQ */}
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 5vw' }}>
        <FAQ items={frontmatter.faq} variant={variant} />
      </div>

      {/* End CTA */}
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 5vw 32px' }}>
        <ArticleCTA variant="full" theme={variant} href={frontmatter.cta_url} label={frontmatter.cta_label} />
      </div>

      {/* Related */}
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 5vw' }}>
        <InternalLinks links={relatedLinks} variant={isDark ? 'dark' : 'legacy'} />
      </div>

      {/* Static reveal script — cached by browser, never inlined per-page (see public/reveal.js) */}
      <script src="/reveal.js" async />
    </>
  )
}
