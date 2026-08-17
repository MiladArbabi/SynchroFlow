import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

const helpRoot = path.join(process.cwd(), 'content', 'help')

export interface HelpFrontmatter {
  title: string
  description: string
  category: string
  audience: string[]
  keywords: string[]
  searchAliases: string[]
  order: number
  lastReviewed: string
  relatedArticles?: string[]
}

export interface HelpArticle {
  category: string
  slug: string
  frontmatter: HelpFrontmatter
  content: string
}

/**
 * Help content is deliberately separate from marketing MDX content.
 * Operational documentation uses category/slug paths and support-specific
 * metadata rather than blog SEO/CTA fields.
 */
export function getHelpArticle(category: string, slug: string): HelpArticle {
  const filePath = path.join(helpRoot, category, `${slug}.mdx`)

  if (!fs.existsSync(filePath)) {
    throw new Error(`Help article not found: ${category}/${slug}`)
  }

  const raw = fs.readFileSync(filePath, 'utf8')
  const { data, content } = matter(raw)

  return {
    category,
    slug,
    frontmatter: data as HelpFrontmatter,
    content,
  }
}

export function getAllHelpArticles(): HelpArticle[] {
  if (!fs.existsSync(helpRoot)) return []

  return fs
    .readdirSync(helpRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const category = entry.name
      const categoryPath = path.join(helpRoot, category)

      return fs
        .readdirSync(categoryPath)
        .filter((file) => file.endsWith('.mdx'))
        .map((file) =>
          getHelpArticle(category, file.replace(/\.mdx$/, ''))
        )
    })
    .sort((a, b) => {
      if (a.frontmatter.category !== b.frontmatter.category) {
        return a.frontmatter.category.localeCompare(b.frontmatter.category)
      }

      return a.frontmatter.order - b.frontmatter.order
    })
}

export function getHelpArticlesByCategory(category: string): HelpArticle[] {
  return getAllHelpArticles().filter(
    (article) => article.category === category
  )
}

export function getAllHelpParams(): { category: string; slug: string }[] {
  return getAllHelpArticles().map(({ category, slug }) => ({
    category,
    slug,
  }))
}