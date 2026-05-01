// app/blog/page.tsx
// Blog index — lists all published articles sorted by date descending.
// Add new articles to /content/blog/*.mdx — they appear here automatically.

import { getAllContent } from '@/lib/mdx'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Blog — LaSyncro',
  description: 'Guides, tips, and operational intelligence for Shopify merchants running their own warehouse.',
  alternates: { canonical: 'https://lasyncro.com/blog' },
}

export default function BlogIndex() {
  const articles = getAllContent('blog').sort(
    (a, b) => new Date(b.frontmatter.date).getTime() - new Date(a.frontmatter.date).getTime()
  )

return (
    <main style={{ maxWidth: '680px', margin: '0 auto', padding: '48px 0' }}>
      <h1 style={{ fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 400, color: 'var(--ink)', marginBottom: '8px' }}>
        Blog
      </h1>
      <p style={{ fontSize: '15px', color: 'var(--ink-3)', marginBottom: '48px', lineHeight: 1.6 }}>
        Operational intelligence for Shopify merchants running their own warehouse.
      </p>

      {articles.length === 0 && (
        <p style={{ color: 'var(--ink-4)' }}>No articles published yet.</p>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {articles.map((article) => (
          <li key={article.slug} style={{
            background: '#FFFFFF',
            border: '1px solid #E8E6E0',
            borderRadius: '12px',
            marginBottom: '16px',
            overflow: 'hidden',
          }}>
            <a href={`/blog/${article.slug}`} style={{
              textDecoration: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '24px 28px',
            }}>
              <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#FF6B2B' }}>
                {article.frontmatter.tags?.[0]}
              </span>
              <span style={{ fontSize: '18px', fontWeight: 500, color: 'var(--ink)', lineHeight: 1.4 }}>
                {article.frontmatter.title}
              </span>
              <span style={{ fontSize: '14px', color: 'var(--ink-3)', lineHeight: 1.6 }}>
                {article.frontmatter.description}
              </span>
              <span style={{ fontSize: '12px', color: 'var(--ink-4)', marginTop: '4px' }}>
                {article.frontmatter.date}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  )
}