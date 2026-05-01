// components/article/ArticleLayout.tsx
// Wraps all article, compare, and industry pages.
// Uses inline styles exclusively — avoids Tailwind/CSS variable conflicts in production.

import { Frontmatter } from '@/lib/mdx'
import FAQ from './FAQ'
import InternalLinks from './InternalLinks'
import WaitlistCTA from './WaitlistCTA'

interface ArticleLayoutProps {
  frontmatter: Frontmatter
  children: React.ReactNode
  relatedLinks?: { href: string; title: string; description?: string }[]
}

export default function ArticleLayout({
  frontmatter,
  children,
  relatedLinks = [],
}: ArticleLayoutProps) {
  return (
    <article style={{ maxWidth: '680px', margin: '0 auto', padding: '48px 0' }}>

      {/* Article header */}
      <header style={{ marginBottom: '40px' }}>
        <p style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#FF6B2B', marginBottom: '12px' }}>
          {frontmatter.tags?.[0]}
        </p>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: '2.2rem', fontWeight: 400, color: 'var(--ink)', lineHeight: 1.25, marginBottom: '16px' }}>
          {frontmatter.title}
        </h1>
        <p style={{ fontSize: '16px', color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: '12px' }}>
          {frontmatter.description}
        </p>
        <p style={{ fontSize: '12px', color: 'var(--ink-4)' }}>
          {frontmatter.date}
          {frontmatter.lastReviewed !== frontmatter.date && ` · Updated ${frontmatter.lastReviewed}`}
        </p>
      </header>

      {/* MDX body */}
      <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: '1rem', lineHeight: 1.8, color: '#3A3835' }}>
        {children}
      </div>

      {/* Mid-article CTA */}
      <WaitlistCTA variant="inline" text={frontmatter.cta_text} />

      {/* FAQ */}
      <FAQ items={frontmatter.faq} />

      {/* End-of-article CTA */}
      <WaitlistCTA variant="full" />

      {/* Internal links */}
      <InternalLinks links={relatedLinks} />

    </article>
  )
}