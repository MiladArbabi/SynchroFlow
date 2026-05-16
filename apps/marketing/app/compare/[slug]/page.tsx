// app/compare/[slug]/page.tsx
// Dynamic route for competitor comparison pages.
// Content lives in /content/compare/*.mdx — high conversion intent pages.
// Schema: Article + FAQPage + BreadcrumbList.

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

// MDX components — h2/h3 explicitly mapped to prevent browser default bold rendering
const components = {
  QuickAnswer, ArticleImage, HeroVisual, NumberedH3, Checklist, ProductVisual,
  h2: ({ children }: { children: React.ReactNode }) => (
    <h2 style={{
      fontFamily: "'Instrument Serif', Georgia, serif",
      fontSize: '32px', fontWeight: 400,
      lineHeight: 1.25, letterSpacing: '-0.02em',
      color: '#0F0E0D', margin: '56px 0 18px',
    }}>{children}</h2>
  ),
  h3: ({ children }: { children: React.ReactNode }) => (
    <h3 style={{
      fontFamily: "'DM Sans', system-ui, sans-serif",
      fontSize: '18px', fontWeight: 500,
      lineHeight: 1.3, color: '#0F0E0D',
      margin: '36px 0 12px',
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
  return getAllSlugs('compare').map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const { frontmatter } = getContentBySlug('compare', slug)
  return {
    title: `LaSyncro | ${frontmatter.title}`,
    description: frontmatter.description,
    alternates: { canonical: `https://www.lasyncro.com/compare/${slug}` },
    openGraph: {
      title: frontmatter.title,
      description: frontmatter.description,
      url: `https://www.lasyncro.com/blog/${slug}`,
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
    <ArticleLayout frontmatter={frontmatter} relatedLinks={frontmatter.relatedLinks} wordCount={content?.split(/\s+/).length ?? 0}>
      <MDXRemote source={content} components={components} />
      </ArticleLayout>
    </>
  )
}