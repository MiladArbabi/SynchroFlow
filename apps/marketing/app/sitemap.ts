// app/sitemap.ts
// Auto-generated sitemap — reads all MDX slugs and their real dates at build time.
// No manual updates needed — add a .mdx file to /content/* and it appears automatically.
// Submit https://www.lasyncro.com/sitemap.xml to GSC after each deploy.
import { MetadataRoute } from 'next'
import { getAllContent, getAllSlugs } from '@/lib/mdx'
import { getAllHelpArticles } from '@/lib/help'

const BASE_URL = 'https://www.lasyncro.com'

function contentDate(frontmatter: { lastReviewed?: string; date?: string }): Date | undefined {
  const raw = frontmatter.lastReviewed ?? frontmatter.date
  if (!raw) return undefined

  const value = new Date(raw)
  return Number.isNaN(value.getTime()) ? undefined : value
}

function latestDate(values: Array<Date | undefined>): Date | undefined {
  const valid = values.filter((value): value is Date => Boolean(value))

  if (valid.length === 0) return undefined

  return new Date(Math.max(...valid.map((value) => value.getTime())))
}

export default function sitemap(): MetadataRoute.Sitemap {
  const blogItems = getAllContent('blog')
  const compareItems = getAllContent('compare')

  // Industries and features currently have no content. Keep their route
  // discovery wired, but do not invent a lastModified date at build time.
  const industrySlugs = getAllSlugs('industries')
  const featureSlugs = getAllSlugs('features')

  // Help routes are generated from the canonical Help corpus so every new
  // category/article becomes discoverable without manual sitemap maintenance.
  const helpArticles = getAllHelpArticles()
  const helpCategories = [
    ...new Set(helpArticles.map((article) => article.category)),
  ]

  const blogLastModified = latestDate(
    blogItems.map(({ frontmatter }) => contentDate(frontmatter))
  )
  const compareLastModified = latestDate(
    compareItems.map(({ frontmatter }) => contentDate(frontmatter))
  )
  const helpLastModified = latestDate(
    helpArticles.map(({ frontmatter }) => contentDate(frontmatter))
  )

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: new Date('2026-05-01'),
      priority: 1.0,
      changeFrequency: 'weekly',
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: new Date('2026-05-01'),
      priority: 0.8,
      changeFrequency: 'monthly',
    },
    {
      url: `${BASE_URL}/blog`,
      lastModified: blogLastModified,
      priority: 0.9,
      changeFrequency: 'daily',
    },
    {
      url: `${BASE_URL}/compare`,
      lastModified: compareLastModified,
      priority: 0.8,
      changeFrequency: 'weekly',
    },
    {
      url: `${BASE_URL}/privacy`,
      lastModified: new Date('2026-05-17'),
      priority: 0.3,
      changeFrequency: 'yearly',
    },
    {
      url: `${BASE_URL}/terms`,
      lastModified: new Date('2026-05-17'),
      priority: 0.3,
      changeFrequency: 'yearly',
    },
    {
      url: `${BASE_URL}/pricing`,
      lastModified: new Date('2026-05-21'),
      priority: 0.8,
      changeFrequency: 'monthly',
    },
    {
      url: `${BASE_URL}/faq`,
      lastModified: new Date('2026-05-21'),
      priority: 0.7,
      changeFrequency: 'monthly',
    },
    {
      url: `${BASE_URL}/help`,
      lastModified: helpLastModified,
      priority: 0.8,
      changeFrequency: 'weekly',
    },
  ]

  const dynamicRoutes: MetadataRoute.Sitemap = [
    // Blog — reviewed date first, then publish date. If neither exists,
    // omit lastModified rather than substituting deployment time.
    ...blogItems.map(({ slug, frontmatter }) => ({
      url: `${BASE_URL}/blog/${slug}`,
      lastModified: contentDate(frontmatter),
      priority: 0.8,
      changeFrequency: 'weekly' as const,
    })),

    // Compare — same truthful freshness policy as blog content.
    ...compareItems.map(({ slug, frontmatter }) => ({
      url: `${BASE_URL}/compare/${slug}`,
      lastModified: contentDate(frontmatter),
      priority: 0.8,
      changeFrequency: 'monthly' as const,
    })),

    // No trustworthy per-page metadata exists yet for these future routes.
    ...industrySlugs.map((slug) => ({
      url: `${BASE_URL}/industries/${slug}`,
      priority: 0.7,
      changeFrequency: 'monthly' as const,
    })),

    ...featureSlugs.map((slug) => ({
      url: `${BASE_URL}/features/${slug}`,
      priority: 0.7,
      changeFrequency: 'monthly' as const,
    })),

    // Category freshness is the newest reviewed/published article in the category.
    ...helpCategories.map((category) => ({
      url: `${BASE_URL}/help/${category}`,
      lastModified: latestDate(
        helpArticles
          .filter((article) => article.category === category)
          .map(({ frontmatter }) => contentDate(frontmatter))
      ),
      priority: 0.7,
      changeFrequency: 'weekly' as const,
    })),

    // Help articles use their own reviewed/published metadata.
    ...helpArticles.map(({ category, slug, frontmatter }) => ({
      url: `${BASE_URL}/help/${category}/${slug}`,
      lastModified: contentDate(frontmatter),
      priority: 0.7,
      changeFrequency: 'weekly' as const,
    })),
  ]

  return [...staticRoutes, ...dynamicRoutes]
}
