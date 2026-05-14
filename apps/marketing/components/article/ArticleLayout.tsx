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
  // wordCount: raw body word count passed from page.tsx — used for accurate read time
  wordCount: number
  // basePath: controls breadcrumb root — 'blog' | 'compare' | 'industries' | 'features'
  basePath?: { href: string; label: string }
}

export default function ArticleLayout({ 
  frontmatter, 
  children, 
  relatedLinks = [], 
  wordCount, 
  basePath = { href: '/blog', label: 'Blog' } 
}: ArticleLayoutProps) {
  // 200 wpm average reading speed; minimum 1 min
  const readTime = Math.max(1, Math.ceil(wordCount / 200))

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
            <Link href={basePath.href} style={{ color: '#6B7280', textDecoration: 'none', borderBottom: 'none' }}>{basePath.label}</Link>            <span style={{ color: '#9CA3AF' }}>·</span>
            <span style={{ color: '#FF6B2B' }}>{frontmatter.tags?.[0]}</span>
            <span style={{ color: '#9CA3AF' }}>·</span>
            <span>{readTime} min read</span>
          </div>

          {/* Title */}
          <h1 style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 'clamp(36px, 5vw, 56px)',
            fontWeight: 400,
            lineHeight: 1.2,
            letterSpacing: '-0.02em',
            color: '#0F0E0D',
            margin: '0 0 32px',
          }}>
            {frontmatter.titleAccent ? (
              <>
                {frontmatter.title}{' '}
                <em style={{ color: '#FF6B2B', fontStyle: 'italic' }}>{frontmatter.titleAccent}</em>
              </>
            ) : frontmatter.title}
          </h1>

          {/* Deck / description */}
          <p style={{
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: '19px', fontWeight: 300,
            lineHeight: 1.55, color: '#3A3835',
            margin: '0 0 36px',
          }}>
            {frontmatter.description}
          </p>

          {/* Meta row */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '18px',
            fontFamily: "'DM Sans', system-ui, sans-serif",
            fontSize: '12px', fontWeight: 500, color: '#6B7280',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#3A3835' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="https://www.lasyncro.com/favicon.png" alt="" width={20} height={20} style={{ borderRadius: '4px', display: 'block' }} />
              <span>LaSyncro</span>
            </div>
            <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#9CA3AF' }} />
            <span>{new Date(frontmatter.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
            {frontmatter.lastReviewed !== frontmatter.date && (
              <>
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#9CA3AF' }} />
                <span>Last reviewed {new Date(frontmatter.lastReviewed).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              </>
            )}
            {frontmatter.tags?.length > 0 && (
              <>
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#9CA3AF' }} />
                <span>{frontmatter.tags.join(' · ')}</span>
              </>
            )}
          </div>
         </header>

        {/* Faded divider between header and hero visual */}
        <div style={{
          height: '1px',
          background: 'linear-gradient(90deg, transparent, #E8E6E0 20%, #E8E6E0 80%, transparent)',
          margin: '0',
        }} />
      </div>

      {/* Article body */}
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 5vw' }}>
        <article style={{ padding: '56px 0 32px' }}>
          {children}
          <WaitlistCTA variant="inline" text={frontmatter.cta_text} />
        </article>
      </div>

      {/* Divider before FAQ */}
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 5vw' }}>
        <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent, #E8E6E0 20%, #E8E6E0 80%, transparent)', margin: '0 0 72px' }} />
      </div>

      {/* FAQ */}
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 5vw' }}>
        <FAQ items={frontmatter.faq} />
      </div>

       {/* Divider before FAQ */}
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 5vw' }}>
        <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent, #E8E6E0 20%, #E8E6E0 80%, transparent)', margin: '0 0 72px' }} />
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