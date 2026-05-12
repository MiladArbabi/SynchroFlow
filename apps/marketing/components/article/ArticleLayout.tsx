// components/article/ArticleLayout.tsx
// Full article layout matching the redesigned blog post template.
// Used by blog, compare, features, and industries routes.

import { Frontmatter } from '@/lib/mdx'
import FAQ from './FAQ'
import InternalLinks from './InternalLinks'
import WaitlistCTA from './WaitlistCTA'
import Link from 'next/link'

interface ArticleLayoutProps {
  frontmatter: Frontmatter
  children: React.ReactNode
  relatedLinks?: { href: string; title: string; description?: string }[]
}

export default function ArticleLayout({ frontmatter, children, relatedLinks = [] }: ArticleLayoutProps) {
  const readTime = Math.ceil((frontmatter.title + ' ').length / 5 / 200) + 7

  return (
    <>
      {/* Article header */}
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 5vw' }}>
        <header style={{ padding: '88px 0 44px', borderBottom: '1px solid var(--rule)' }}>
          {/* Breadcrumbs */}
          <div style={{
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: '11px', fontWeight: 500,
            letterSpacing: '0.12em', textTransform: 'uppercase',
            color: '#6B7280', marginBottom: '28px',
            display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            <Link href="/blog" style={{ color: '#6B7280', textDecoration: 'none', borderBottom: 'none' }}>Blog</Link>
            <span style={{ color: '#9CA3AF' }}>·</span>
            <span style={{ color: '#FF6B2B' }}>{frontmatter.tags?.[0]}</span>
            <span style={{ color: '#9CA3AF' }}>·</span>
            <span>{readTime} min read</span>
          </div>

          {/* Title */}
          <h1 style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 'clamp(36px, 5vw, 56px)',
            fontWeight: 400,
            lineHeight: 1.12,
            letterSpacing: '-0.02em',
            color: '#0F0E0D',
            margin: '0 0 28px',
          }}>
            {frontmatter.title}
          </h1>

          {/* Deck / description */}
          <p style={{
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: '19px', fontWeight: 300,
            lineHeight: 1.55, color: '#3A3835',
            margin: '0 0 32px', maxWidth: '640px',
          }}>
            {frontmatter.description}
          </p>

          {/* Meta row */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px',
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: '12px', fontWeight: 500, color: '#6B7280',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#3A3835' }}>
              <span style={{
                width: '30px', height: '30px', borderRadius: '50%',
                background: '#FFF0E8', color: '#FF6B2B',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', fontWeight: 500, letterSpacing: '0.04em',
              }}>LS</span>
              <span>LaSyncro</span>
            </div>
            <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#9CA3AF' }} />
            <span>{frontmatter.date}</span>
            {frontmatter.lastReviewed !== frontmatter.date && (
              <>
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#9CA3AF' }} />
                <span>Updated {frontmatter.lastReviewed}</span>
              </>
            )}
          </div>
        </header>
      </div>

      {/* Article body */}
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 5vw' }}>
        <article style={{ padding: '56px 0 32px' }}>
          {children}
          <WaitlistCTA variant="inline" text={frontmatter.cta_text} />
        </article>
      </div>

      {/* FAQ */}
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 5vw' }}>
        <FAQ items={frontmatter.faq} />
      </div>

      {/* End CTA */}
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 5vw 32px' }}>
        <WaitlistCTA variant="full" />
      </div>

      {/* Related */}
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 5vw' }}>
        <InternalLinks links={relatedLinks} />
      </div>

      {/* Reveal script */}
      <script dangerouslySetInnerHTML={{ __html: `
        (function(){
          var io = new IntersectionObserver(function(entries){
            entries.forEach(function(e){
              if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
            });
          }, { threshold: 0.07 });
          document.querySelectorAll('.reveal').forEach(function(el){ io.observe(el); });
        })();
      `}} />
    </>
  )
}