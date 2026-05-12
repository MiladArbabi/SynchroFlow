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

// MDX components available inside .mdx files
const components = { QuickAnswer, ArticleImage, HeroVisual, NumberedH3, Checklist, ProductVisual }

export async function generateStaticParams() {
  return getAllSlugs('compare').map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const { frontmatter } = getContentBySlug('compare', slug)
  return {
    title: `${frontmatter.title} — LaSyncro`,
    description: frontmatter.description,
    alternates: { canonical: `https://www.lasyncro.com/compare/${slug}` },
    openGraph: {
      title: frontmatter.title,
      description: frontmatter.description,
      url: `https://www.lasyncro.com/compare/${slug}`,
      type: 'article',
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
      <ArticleLayout frontmatter={frontmatter} relatedLinks={frontmatter.relatedLinks}>
        <MDXRemote source={content} components={components} />
      </ArticleLayout>
    </>
  )
}