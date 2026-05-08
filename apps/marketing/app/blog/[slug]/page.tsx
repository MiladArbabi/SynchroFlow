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
import { Metadata } from 'next'

// MDX components available inside .mdx files
const components = { QuickAnswer, ArticleImage }

export async function generateStaticParams() {
  return getAllSlugs('blog').map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const { frontmatter } = getContentBySlug('blog', slug)
  return {
    title: `${frontmatter.title} — LaSyncro`,
    description: frontmatter.description,
    alternates: { canonical: `https://www.lasyncro.com/blog/${slug}` },
    openGraph: {
      title: frontmatter.title,
      description: frontmatter.description,
      url: `https://www.lasyncro.com/blog/${slug}`,
      type: 'article',
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
      })} />
      <Schema data={generateFAQSchema(frontmatter.faq)} />
      <Schema data={generateBreadcrumbSchema([
        { name: 'Home', url: 'https://www.lasyncro.com' },
        { name: 'Blog', url: 'https://www.lasyncro.com/blog' },
        { name: frontmatter.title, url },
      ])} />

      <ArticleLayout frontmatter={frontmatter} relatedLinks={frontmatter.relatedLinks}>
        <MDXRemote source={content} components={components} />
      </ArticleLayout>
    </>
  )
}