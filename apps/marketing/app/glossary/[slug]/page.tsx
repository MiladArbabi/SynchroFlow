// app/glossary/[slug]/page.tsx
// Dynamic route for warehouse operations glossary terms.
// Generates static pages at build time from /content/glossary/*.mdx.
// Schema: DefinedTerm (primary AEO schema) + FAQPage + BreadcrumbList.
// DefinedTerm is specifically used by AI engines to cite definitions.

import { MDXRemote } from 'next-mdx-remote/rsc'
import { getAllSlugs, getContentBySlug } from '@/lib/mdx'
import {
  generateDefinedTermSchema,
  generateFAQSchema,
  generateBreadcrumbSchema,
} from '@/lib/schema'
import Schema from '@/components/seo/Schema'
import ArticleLayout from '@/components/article/ArticleLayout'
import QuickAnswer from '@/components/article/QuickAnswer'
import ArticleImage from '@/components/article/ArticleImage'
import NumberedH3 from '@/components/article/NumberedH3'
import { Metadata } from 'next'
import remarkGfm from 'remark-gfm'

// MDX components — h2/h3 explicitly mapped to prevent browser default bold rendering
const components = {
  QuickAnswer,
  ArticleImage,
  NumberedH3,
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
  return getAllSlugs('glossary').map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const { frontmatter } = getContentBySlug('glossary', slug)
  return {
    title: `${frontmatter.title} — LaSyncro`,
    description: frontmatter.description,
    alternates: { canonical: `https://www.lasyncro.com/glossary/${slug}` },
    openGraph: {
      title: frontmatter.title,
      description: frontmatter.description,
      url: `https://www.lasyncro.com/glossary/${slug}`,
      type: 'article',
      images: [
        {
          url: 'https://www.lasyncro.com/og_image_lightmode.png',
          width: 1200,
          height: 630,
          alt: 'LaSyncro — Operational intelligence for Shopify merchants',
        },
      ],
    },
  }
}

export default async function GlossaryTerm({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { frontmatter, content } = getContentBySlug('glossary', slug)
  const url = `https://www.lasyncro.com/glossary/${slug}`

  return (
    <>
      {/* DefinedTerm schema — primary AEO signal for AI engine citations */}
      <Schema
        data={generateDefinedTermSchema({
          name: frontmatter.title,
          description: frontmatter.description,
        })}
      />
      <Schema data={generateFAQSchema(frontmatter.faq)} />
      <Schema
        data={generateBreadcrumbSchema([
          { name: 'Home', url: 'https://www.lasyncro.com' },
          { name: 'Glossary', url: 'https://www.lasyncro.com/glossary' },
          { name: frontmatter.title, url },
        ])}
      />

      <ArticleLayout
        frontmatter={frontmatter}
        relatedLinks={frontmatter.relatedLinks}
        wordCount={content?.split(/\s+/).length ?? 0}
        basePath={{ href: '/glossary', label: 'Glossary' }}
      >
        <MDXRemote
          source={content}
          components={components}
          options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }}
        />
      </ArticleLayout>
    </>
  )
}