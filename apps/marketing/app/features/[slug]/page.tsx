// app/features/[slug]/page.tsx
// Dynamic route for feature landing pages (morning-brief, po-receiving, traceability, workforce).
// Schema: SoftwareApplication + FAQPage + BreadcrumbList.

import { MDXRemote } from 'next-mdx-remote/rsc'
import { getAllSlugs, getContentBySlug } from '@/lib/mdx'
import { generateSoftwareSchema, generateFAQSchema, generateBreadcrumbSchema } from '@/lib/schema'
import Schema from '@/components/seo/Schema'
import ArticleLayout from '@/components/article/ArticleLayout'
import QuickAnswer from '@/components/article/QuickAnswer'
import { Metadata } from 'next'

const components = { QuickAnswer }

export async function generateStaticParams() {
  return getAllSlugs('features').map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const { frontmatter } = getContentBySlug('features', slug)
  return {
    title: `${frontmatter.title} — LaSyncro`,
    description: frontmatter.description,
    alternates: { canonical: `https://www.lasyncro.com/features/${slug}` },
    openGraph: {
      title: frontmatter.title,
      description: frontmatter.description,
      url: `https://lasyncro.com/features/${slug}`,
      type: 'website',
    },
  }
}

export default async function FeaturePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { frontmatter, content } = getContentBySlug('features', slug)
  const url = `https://lasyncro.com/features/${slug}`

  return (
    <>
      <Schema data={generateSoftwareSchema({
        name: frontmatter.title,
        description: frontmatter.description,
        url,
      })} />
      <Schema data={generateFAQSchema(frontmatter.faq)} />
      <Schema data={generateBreadcrumbSchema([
        { name: 'Home', url: 'https://lasyncro.com' },
        { name: 'Features', url: 'https://lasyncro.com/features' },
        { name: frontmatter.title, url },
      ])} />
      <ArticleLayout frontmatter={frontmatter}>
        <MDXRemote source={content} components={components} />
      </ArticleLayout>
    </>
  )
}