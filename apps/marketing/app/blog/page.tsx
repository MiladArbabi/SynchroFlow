// app/blog/page.tsx
// Server component — reads MDX at build time, passes pre-serialised data to BlogIndex.
// Split required: getAllContent() uses Node fs (server-only);
// filter tabs + hover state need 'use client'.

import { getAllContent, type ContentItem } from '@/lib/mdx'
import { Metadata } from 'next'
import BlogIndex from './BlogIndex'

export const metadata: Metadata = {
  title: 'Blog — LaSyncro',
  description:
    "Guides, post-mortems, and field notes for Shopify operators stuck between spreadsheets and enterprise systems they don't need.",
  alternates: { canonical: 'https://www.lasyncro.com/blog' },
}

export default function BlogPage() {
  const articles: ContentItem[] = getAllContent('blog').sort(
    (a, b) =>
      new Date(b.frontmatter.date).getTime() - new Date(a.frontmatter.date).getTime()
  )

  return <BlogIndex articles={articles} />
}