// app/blog/[slug]/page.tsx
// Dynamic route for all blog articles.
// Generates static pages at build time from /content/blog/*.mdx.
// Schema: Article + FAQPage + BreadcrumbList injected server-side.

import { MDXRemote } from 'next-mdx-remote/rsc'
import { getAllSlugs, getContentBySlug } from '@/lib/mdx'
import { generateArticleSchema, generateFAQSchema, generateBreadcrumbSchema } from '@/lib/schema'
import Schema from '@/components/seo/Schema'
import ArticleLayout from '@/components/article/ArticleLayout'
import QuickAnswer from '@/components/article/QuickAnswer'
import ArticleImage from '@/components/article/ArticleImage'
import HeroVisual from '@/components/article/HeroVisual'
import ProductVisual from '@/components/article/ProductVisual'
import NumberedH3 from '@/components/article/NumberedH3'
import Checklist from '@/components/article/Checklist'
import { Metadata } from 'next'
import remarkGfm from 'remark-gfm'

// MDX components available inside .mdx files
// MDX components — h2/h3 explicitly mapped to prevent browser default bold rendering
const components = {
  QuickAnswer, ArticleImage, HeroVisual, NumberedH3, Checklist, ProductVisual,
  // Styled table components — renders MDX pipe tables with brand design system
  table: ({ children }: { children: React.ReactNode }) => (
    <div style={{ overflowX: 'auto', margin: '32px 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: '14px' }}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: { children: React.ReactNode }) => (
    <thead style={{ borderBottom: '2px solid #E8E6E0' }}>{children}</thead>
  ),
  tbody: ({ children }: { children: React.ReactNode }) => (
    <tbody>{children}</tbody>
  ),
  tr: ({ children }: { children: React.ReactNode }) => (
    <tr style={{ borderBottom: '1px solid #F3F2EF' }}>{children}</tr>
  ),
  th: ({ children }: { children: React.ReactNode }) => (
    <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 500, color: '#6B7280', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>
      {children}
    </th>
  ),
  td: ({ children }: { children: React.ReactNode }) => (
    <td style={{ padding: '12px 16px', color: '#3A3835', fontWeight: 300, lineHeight: 1.5, verticalAlign: 'top' }}>
      {children}
    </td>
  ),
  h2: ({ children }: { children: React.ReactNode }) => (
    <h2 style={{
      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      fontSize: '32px', fontWeight: 400,
      lineHeight: 1.25, letterSpacing: '-0.02em',
      color: '#0F0E0D', margin: '40px 0 14px',
    }}>{children}</h2>
  ),
  h3: ({ children }: { children: React.ReactNode }) => (
    <h3 style={{
      fontFamily: "'DM Sans', system-ui, sans-serif",
      fontSize: '18px', fontWeight: 500,
      lineHeight: 1.3, color: '#0F0E0D',
      margin: '24px 0 10px',
    }}>{children}</h3>
  ),
  p: ({ children }: { children: React.ReactNode }) => (
    <p style={{
      fontFamily: "'DM Sans', system-ui, sans-serif",
      fontSize: '17px', fontWeight: 300,
      lineHeight: 1.75, color: '#3A3835',
      margin: '0 0 22px',
    }}>{children}</p>
  ),
  ul: ({ children }: { children: React.ReactNode }) => (
    <ul style={{ paddingLeft: '1.4rem', margin: '0 0 22px' }}>{children}</ul>
  ),
  li: ({ children }: { children: React.ReactNode }) => (
    <li style={{
      fontFamily: "'DM Sans', system-ui, sans-serif",
      fontSize: '17px', fontWeight: 300,
      lineHeight: 1.7, color: '#3A3835',
      marginBottom: '6px',
    }}>{children}</li>
  ),
  strong: ({ children }: { children: React.ReactNode }) => (
    <strong style={{ fontWeight: 500, color: '#0F0E0D' }}>{children}</strong>
  ),
}

export async function generateStaticParams() {
  return getAllSlugs('blog').map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const { frontmatter } = getContentBySlug('blog', slug)
  const fallbackImage = 'https://www.lasyncro.com/og_image_lightmode.png'
  const articleImagePath = frontmatter.ogImage ?? frontmatter.image
  const articleImage = articleImagePath ? `https://www.lasyncro.com/${articleImagePath}` : fallbackImage
  const articleImageAlt = frontmatter.imageAlt ?? 'LaSyncro — Operational intelligence for Shopify merchants'

  return {
    // Keyword-first format: primary keyword leads, brand appended — maximises CTR on non-branded queries
    title: `${frontmatter.title} — LaSyncro`,
    description: frontmatter.description,
    alternates: { canonical: `https://www.lasyncro.com/blog/${slug}` },
    openGraph: {
      title: frontmatter.title,
      description: frontmatter.description,
      url: `https://www.lasyncro.com/blog/${slug}`,
      type: 'article',
      images: [
        {
          url: articleImage,
          width: 1200,
          height: 630,
          alt: articleImageAlt,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: frontmatter.title,
      description: frontmatter.description,
      images: [articleImage],
    },
  }
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { frontmatter, content } = getContentBySlug('blog', slug)
  const url = `https://www.lasyncro.com/blog/${slug}`

  return (
    <>
      {/* Article schema — server-side only */}
      <Schema data={generateArticleSchema({
        title: frontmatter.title,
        description: frontmatter.description,
        url,
        datePublished: frontmatter.date,
        dateModified: frontmatter.lastReviewed,
        image: frontmatter.ogImage || frontmatter.image ? `https://www.lasyncro.com/${frontmatter.ogImage ?? frontmatter.image}` : undefined,
      })} />
      <Schema data={generateFAQSchema(frontmatter.faq)} />
      <Schema data={generateBreadcrumbSchema([
        { name: 'Home', url: 'https://www.lasyncro.com' },
        { name: 'Blog', url: 'https://www.lasyncro.com/blog' },
        { name: frontmatter.title, url },
      ])} />

      <ArticleLayout frontmatter={frontmatter} relatedLinks={frontmatter.relatedLinks} wordCount={content?.split(/\s+/).length ?? 0}>
        <MDXRemote source={content} components={components} options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }} />
      </ArticleLayout>
    </>
  )
}