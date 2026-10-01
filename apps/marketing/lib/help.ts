import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'

const helpRoot = path.join(process.cwd(), 'content', 'help')

export interface HelpCategory {
  slug: string
  label: string
  description: string
  order: number
}

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

export interface HelpCategoryWithCount extends HelpCategory {
  articleCount: number
}

export interface RelatedHelpArticle {
  href: string
  title: string
  description?: string
}

export interface HelpRegistryValidation {
  discoveredCategoryCount: number
  registryCategoryCount: number
  missingRegistryEntries: string[]
  orphanRegistryEntries: string[]
  frontmatterCategoryMismatches: {
    article: string
    expected: string
    actual: string
  }[]
}

const HELP_CATEGORIES: HelpCategory[] = [
  {
    slug: 'getting-started',
    label: 'Getting Started',
    description: 'Get into LaSyncro, connect Shopify, and complete your first warehouse setup.',
    order: 1,
  },
  {
    slug: 'shopify',
    label: 'Shopify',
    description: 'Connect Shopify and understand catalog, order, inventory, and fulfillment sync.',
    order: 2,
  },
  {
    slug: 'warehouse',
    label: 'Warehouse',
    description: 'Set up locations, labels, printers, routing, and floor tools.',
    order: 3,
  },
  {
    slug: 'products',
    label: 'Products',
    description: 'Manage catalog details, barcodes, readiness, labels, and costs.',
    order: 4,
  },
  {
    slug: 'suppliers',
    label: 'Suppliers',
    description: 'Manage suppliers, purchase orders, sourcing, and reorder signals.',
    order: 5,
  },
  {
    slug: 'receiving',
    label: 'Receiving',
    description: 'Receive purchase orders and record what actually arrived.',
    order: 6,
  },
  {
    slug: 'stowing',
    label: 'Stowing',
    description: 'Place received stock into warehouse locations and handle stow issues.',
    order: 7,
  },
  {
    slug: 'inventory',
    label: 'Inventory',
    description: 'Understand stock quantities, reservations, locations, and data quality.',
    order: 8,
  },
  {
    slug: 'orders',
    label: 'Orders',
    description: 'Understand order flow and release work into fulfillment batches.',
    order: 9,
  },
  {
    slug: 'picking',
    label: 'Picking',
    description: 'Pick released batches and handle pick exceptions.',
    order: 10,
  },
  {
    slug: 'packing',
    label: 'Packing',
    description: 'Pack picked orders with scans and prepare shipping labels.',
    order: 11,
  },
  {
    slug: 'problem-center',
    label: 'Problem Center',
    description: 'Review and resolve warehouse exceptions that need follow-up.',
    order: 12,
  },
  {
    slug: 'returns',
    label: 'Returns',
    description: 'Process, monitor, and analyze returned items.',
    order: 13,
  },
  {
    slug: 'users',
    label: 'Users & Permissions',
    description: 'Manage team members, roles, permissions, and access.',
    order: 14,
  },
  {
    slug: 'billing',
    label: 'Billing',
    description: 'Review your plan, usage, seats, and billing actions.',
    order: 15,
  },
  {
    slug: 'troubleshooting',
    label: 'Troubleshooting',
    description: 'Diagnose common access, alert, barcode, printing, and workflow issues.',
    order: 16,
  },
]

const LEGACY_FRONTMATTER_CATEGORY_LABELS: Record<string, string[]> = {
  users: ['Users'],
}

function getHelpCategoryMap(): Map<string, HelpCategory> {
  return new Map(HELP_CATEGORIES.map((category) => [category.slug, category]))
}

function articleHref(article: Pick<HelpArticle, 'category' | 'slug'>): string {
  return `/help/${article.category}/${article.slug}`
}

function isAllowedFrontmatterCategoryLabel(
  slug: string,
  registryLabel: string,
  frontmatterLabel: string
): boolean {
  return (
    frontmatterLabel === registryLabel ||
    (LEGACY_FRONTMATTER_CATEGORY_LABELS[slug] ?? []).includes(frontmatterLabel)
  )
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

export function getHelpCategories(): HelpCategory[] {
  return [...HELP_CATEGORIES].sort((a, b) => a.order - b.order)
}

export function getHelpCategory(slug: string): HelpCategory | undefined {
  return getHelpCategoryMap().get(slug)
}

export function validateHelpCategoryRegistry(
  articles: HelpArticle[] = getAllHelpArticles()
): HelpRegistryValidation {
  const registry = getHelpCategoryMap()
  const discovered = new Set(articles.map((article) => article.category))
  const registrySlugs = new Set(registry.keys())

  const missingRegistryEntries = [...discovered]
    .filter((slug) => !registrySlugs.has(slug))
    .sort()

  const orphanRegistryEntries = [...registrySlugs]
    .filter((slug) => !discovered.has(slug))
    .sort()

  const frontmatterCategoryMismatches = articles.flatMap((article) => {
    const registryEntry = registry.get(article.category)
    if (!registryEntry) return []

    if (
      isAllowedFrontmatterCategoryLabel(
        article.category,
        registryEntry.label,
        article.frontmatter.category
      )
    ) {
      return []
    }

    return [{
      article: articleHref(article),
      expected: registryEntry.label,
      actual: article.frontmatter.category,
    }]
  })

  return {
    discoveredCategoryCount: discovered.size,
    registryCategoryCount: registrySlugs.size,
    missingRegistryEntries,
    orphanRegistryEntries,
    frontmatterCategoryMismatches,
  }
}

export function assertHelpCategoryRegistry(
  articles: HelpArticle[] = getAllHelpArticles()
): void {
  const validation = validateHelpCategoryRegistry(articles)
  const failures = [
    validation.missingRegistryEntries.length > 0
      ? `missing registry entries: ${validation.missingRegistryEntries.join(', ')}`
      : null,
    validation.orphanRegistryEntries.length > 0
      ? `orphan registry entries: ${validation.orphanRegistryEntries.join(', ')}`
      : null,
    validation.frontmatterCategoryMismatches.length > 0
      ? `frontmatter category mismatches: ${validation.frontmatterCategoryMismatches
          .map((item) => `${item.article} expected "${item.expected}" got "${item.actual}"`)
          .join('; ')}`
      : null,
  ].filter(Boolean)

  if (failures.length > 0) {
    throw new Error(`Help category registry drift detected: ${failures.join(' | ')}`)
  }
}

export function getHelpCategoriesWithCounts(): HelpCategoryWithCount[] {
  const articles = getAllHelpArticles()
  assertHelpCategoryRegistry(articles)

  const counts = articles.reduce<Record<string, number>>((acc, article) => {
    acc[article.category] = (acc[article.category] ?? 0) + 1
    return acc
  }, {})

  return getHelpCategories().map((category) => ({
    ...category,
    articleCount: counts[category.slug] ?? 0,
  }))
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

export function resolveRelatedHelpArticles(
  sourceArticle: HelpArticle,
  relatedArticles: string[] | undefined = sourceArticle.frontmatter.relatedArticles
): RelatedHelpArticle[] {
  if (!relatedArticles || relatedArticles.length === 0) return []

  const sourceHref = articleHref(sourceArticle)

  return relatedArticles.flatMap((href) => {
    if (href === sourceHref) return []

    const match = href.match(/^\/help\/([^/]+)\/([^/]+)$/)

    if (!match) {
      throw new Error(
        `Invalid related Help article href in ${sourceHref}: ${href}`
      )
    }

    const [, category, slug] = match

    try {
      const related = getHelpArticle(category, slug)
      return [{
        href,
        title: related.frontmatter.title,
        description: related.frontmatter.description,
      }]
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('Help article not found:')
      ) {
        throw new Error(
          `Broken related Help article href in ${sourceHref}: ${href}`
        )
      }

      throw error
    }
  })
}
