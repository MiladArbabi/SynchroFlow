// lib/mdx.ts
// Content loader for all MDX-based routes (blog, compare, industries, features).
// Uses gray-matter for frontmatter parsing. All content lives in /content/<type>/<slug>.mdx.

import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

const contentRoot = path.join(process.cwd(), 'content')

export type ContentType = 'blog' | 'compare' | 'industries' | 'features' | 'glossary'

export interface Frontmatter {
  title: string
  description: string
  date: string
  lastReviewed: string
  author: string
  titleAccent?: string
  // Site-relative public asset paths used for article body, OG/Twitter, and Article schema.
  // Example: "shopify-warehouse-workflow.png"
  image?: string
  ogImage?: string
  imageAlt?: string
  tags: string[]
  primaryKeyword: string
  secondaryKeywords: string[]
  vector: number
  cta_text: string
  cta_url: string
  faq: { question: string; answer: string }[]
  relatedLinks?: { href: string; title: string; description?: string }[]
}

export interface ContentItem {
  slug: string
  frontmatter: Frontmatter
  content: string
}

/** Returns all slugs for a given content type — used by generateStaticParams() */
export function getAllSlugs(type: ContentType): string[] {
  const dir = path.join(contentRoot, type)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.mdx'))
    .map((f) => f.replace(/\.mdx$/, ''))
}

/** Loads and parses a single MDX file by type + slug */
export function getContentBySlug(type: ContentType, slug: string): ContentItem {
  const filePath = path.join(contentRoot, type, `${slug}.mdx`)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Content not found: ${type}/${slug}`)
  }
  const raw = fs.readFileSync(filePath, 'utf8')
  const { data, content } = matter(raw)
  return {
    slug,
    frontmatter: data as Frontmatter,
    content,
  }
}

/** Returns all items for a content type — used by index pages */
export function getAllContent(type: ContentType): ContentItem[] {
  return getAllSlugs(type).map((slug) => getContentBySlug(type, slug))
}