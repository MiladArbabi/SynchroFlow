// app/compare/[slug]/page.tsx
// Dynamic route for competitor comparison pages.
// Content lives in /content/compare/*.mdx — high conversion intent pages.
// Schema: Article + FAQPage + BreadcrumbList.

import { MDXRemote } from 'next-mdx-remote/rsc'
import { getAllSlugs, getContentBySlug } from '@/lib/mdx'
import { generateArticleSchema, generateFAQSchema, generateBreadcrumbSchema } from '@/lib/schema'
import Schema from '@/components/seo/Schema'
import ArticleLayout from '@/components/article/ArticleLayout'
import CompareArticleTracker from '@/components/compare/CompareArticleTracker'
import LaunchNotifyForm from '@/components/conversion/LaunchNotifyForm'
import { ContentShell } from '@/components/content'
import QuickAnswer from '@/components/article/QuickAnswer'
import ArticleImage from '@/components/article/ArticleImage'
import HeroVisual from '@/components/article/HeroVisual'
import ProductVisual from '@/components/article/ProductVisual'
import NumberedH3 from '@/components/article/NumberedH3'
import Checklist from '@/components/article/Checklist'
import { Metadata } from 'next'
import remarkGfm from 'remark-gfm'
import type { ComponentProps } from 'react'

// MDX components — h2/h3 explicitly mapped to prevent browser default bold rendering
const components = {
  QuickAnswer: (props: ComponentProps<typeof QuickAnswer>) => <QuickAnswer {...props} variant="dark" />,
  ArticleImage: (props: ComponentProps<typeof ArticleImage>) => <ArticleImage {...props} variant="dark" />,
  HeroVisual: (props: ComponentProps<typeof HeroVisual>) => <HeroVisual {...props} variant="dark" />,
  NumberedH3: (props: ComponentProps<typeof NumberedH3>) => <NumberedH3 {...props} variant="dark" />,
  Checklist,
  ProductVisual: (props: ComponentProps<typeof ProductVisual>) => <ProductVisual {...props} variant="dark" />,
  // Styled table components — renders MDX pipe tables with brand design system
  table: ({ children }: { children: React.ReactNode }) => (
    <div style={{ overflowX: 'auto', margin: '32px 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--sans)', fontSize: '14px' }}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: { children: React.ReactNode }) => (
    <thead style={{ borderBottom: '2px solid var(--rule-2)' }}>{children}</thead>
  ),
  tbody: ({ children }: { children: React.ReactNode }) => (
    <tbody>{children}</tbody>
  ),
  tr: ({ children }: { children: React.ReactNode }) => (
    <tr style={{ borderBottom: '1px solid var(--rule)' }}>{children}</tr>
  ),
  th: ({ children }: { children: React.ReactNode }) => (
    <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 500, color: 'var(--ink-3)', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>
      {children}
    </th>
  ),
  td: ({ children }: { children: React.ReactNode }) => (
    <td style={{ padding: '12px 16px', color: 'var(--ink-2)', fontWeight: 300, lineHeight: 1.5, verticalAlign: 'top' }}>
      {children}
    </td>
  ),
  h2: ({ children }: { children: React.ReactNode }) => (
    <h2 style={{
      fontFamily: 'var(--sans)',
      fontSize: '32px', fontWeight: 400,
      lineHeight: 1.25, letterSpacing: '-0.02em',
      color: 'var(--ink)', margin: '40px 0 14px',
    }}>{children}</h2>
  ),
  h3: ({ children }: { children: React.ReactNode }) => (
    <h3 style={{
      fontFamily: 'var(--sans)',
      fontSize: '18px', fontWeight: 500,
      lineHeight: 1.3, color: 'var(--ink)',
      margin: '24px 0 10px',
    }}>{children}</h3>
  ),
  p: ({ children }: { children: React.ReactNode }) => (
    <p style={{
      fontFamily: 'var(--sans)',
      fontSize: '17px', fontWeight: 300,
      lineHeight: 1.75, color: 'var(--ink-2)',
      margin: '0 0 22px',
    }}>{children}</p>
  ),
  ul: ({ children }: { children: React.ReactNode }) => (
    <ul style={{ paddingLeft: '1.4rem', margin: '0 0 22px' }}>{children}</ul>
  ),
  li: ({ children }: { children: React.ReactNode }) => (
    <li style={{
      fontFamily: 'var(--sans)',
      fontSize: '17px', fontWeight: 300,
      lineHeight: 1.7, color: 'var(--ink-2)',
      marginBottom: '6px',
    }}>{children}</li>
  ),
  strong: ({ children }: { children: React.ReactNode }) => (
    <strong style={{ fontWeight: 500, color: 'var(--ink)' }}>{children}</strong>
  ),
}

export async function generateStaticParams() {
  return getAllSlugs('compare').map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const { frontmatter } = getContentBySlug('compare', slug)
  return {
    // Keyword-first format: primary keyword leads, brand appended — maximises CTR on non-branded queries
    title: `${frontmatter.title} — LaSyncro`,
    description: frontmatter.description,
    alternates: { canonical: `https://www.lasyncro.com/compare/${slug}` },
    openGraph: {
      title: frontmatter.title,
      description: frontmatter.description,
      url: `https://www.lasyncro.com/compare/${slug}`,
      type: 'website',
      images: [
        {
          url: 'https://www.lasyncro.com/og_image_lightmode.png',
          width: 1200,
          height: 630,
          alt: 'LaSyncro — Operational intelligence for Shopify merchants',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: frontmatter.title,
      description: frontmatter.description,
      images: ['https://www.lasyncro.com/og_image_lightmode.png'],
    },
  }
}

export default async function ComparePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { frontmatter, content } = getContentBySlug('compare', slug)
  const url = `https://www.lasyncro.com/compare/${slug}`

  return (
    <>
      <Schema data={generateArticleSchema({
        title: frontmatter.title,
        description: frontmatter.description,
        url,
        datePublished: frontmatter.date,
        dateModified: frontmatter.lastReviewed,
      })} />
      <Schema data={generateFAQSchema(frontmatter.faq)} />
      <Schema data={generateBreadcrumbSchema([
        { name: 'Home', url: 'https://www.lasyncro.com' },
        { name: 'Compare', url: 'https://www.lasyncro.com/compare' },
        { name: frontmatter.title, url },
      ])} />
      <CompareArticleTracker competitor={slug} />
    <ArticleLayout
      frontmatter={frontmatter}
      relatedLinks={frontmatter.relatedLinks}
      wordCount={content?.split(/\s+/).length ?? 0}
      basePath={{ href: '/compare', label: 'Compare' }}
      variant="dark"
    >
      <MDXRemote source={content} components={components} options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }} />
      </ArticleLayout>
      <ContentShell width="article" style={{ paddingTop: 0, paddingBottom: 64 }}>
        <LaunchNotifyForm source="launch_compare" />
      </ContentShell>
    </>
  )
}
