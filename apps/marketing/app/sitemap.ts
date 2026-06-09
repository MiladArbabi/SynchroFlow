// app/sitemap.ts
// Auto-generated sitemap — reads all MDX slugs and their real dates at build time.
// No manual updates needed — add a .mdx file to /content/* and it appears automatically.
// Submit https://www.lasyncro.com/sitemap.xml to GSC after each deploy.
import { MetadataRoute } from 'next'
import { getAllContent, getAllSlugs } from '@/lib/mdx'

const BASE_URL = 'https://www.lasyncro.com'

export default function sitemap(): MetadataRoute.Sitemap {
  const blogItems    = getAllContent('blog')
  const compareItems = getAllContent('compare')
  // industries and features: no content yet — getAllSlugs returns [] safely
  const industrySlugs = getAllSlugs('industries')
  const featureSlugs  = getAllSlugs('features')
  // glossary: grows with each new term added to /content/glossary/
  const glossaryItems  = getAllContent('glossary')

  const staticRoutes: MetadataRoute.Sitemap = [
  { url: BASE_URL,                      lastModified: new Date('2026-05-01'), priority: 1.0, changeFrequency: 'weekly'  },
  { url: `${BASE_URL}/about`,           lastModified: new Date('2026-05-01'), priority: 0.8, changeFrequency: 'monthly' },
  { url: `${BASE_URL}/blog`,            lastModified: new Date(),             priority: 0.9, changeFrequency: 'daily'   },
  { url: `${BASE_URL}/compare`,         lastModified: new Date(),     priority: 0.8, changeFrequency: 'weekly'  },
  { url: `${BASE_URL}/privacy`,         lastModified: new Date('2026-05-17'), priority: 0.3, changeFrequency: 'yearly'  },
  { url: `${BASE_URL}/terms`,           lastModified: new Date('2026-05-17'), priority: 0.3, changeFrequency: 'yearly'  },
  { url: `${BASE_URL}/pricing`,         lastModified: new Date('2026-05-21'), priority: 0.8, changeFrequency: 'monthly' },
  { url: `${BASE_URL}/faq`,             lastModified: new Date('2026-05-21'), priority: 0.7, changeFrequency: 'monthly' },
  { url: `${BASE_URL}/getting-started`, lastModified: new Date('2026-05-21'), priority: 0.7, changeFrequency: 'monthly' },
  { url: `${BASE_URL}/glossary`,        lastModified: new Date(),             priority: 0.8, changeFrequency: 'weekly'  },
]

  const dynamicRoutes: MetadataRoute.Sitemap = [
    // Blog — use lastReviewed so Google sees accurate freshness signals
    ...blogItems.map(({ slug, frontmatter }) => ({
      url:             `${BASE_URL}/blog/${slug}`,
      lastModified:    new Date(frontmatter.lastReviewed),
      priority:        0.8,
      changeFrequency: 'weekly' as const,
    })),
    // Compare — commercial intent pages; use lastReviewed date
    ...compareItems.map(({ slug, frontmatter }) => ({
      url:             `${BASE_URL}/compare/${slug}`,
      lastModified:    new Date(frontmatter.lastReviewed),
      priority:        0.8,
      changeFrequency: 'monthly' as const,
    })),
    // Industries + features: wired up for when content is added
    ...industrySlugs.map((slug) => ({
      url:             `${BASE_URL}/industries/${slug}`,
      lastModified:    new Date(),
      priority:        0.7,
      changeFrequency: 'monthly' as const,
    })),
    ...featureSlugs.map((slug) => ({
      url:             `${BASE_URL}/features/${slug}`,
      lastModified:    new Date(),
      priority:        0.7,
      changeFrequency: 'monthly' as const,
    })),
    // Glossary — definition pages; priority 0.7, monthly change expected
    ...glossaryItems.map(({ slug, frontmatter }) => ({
      url:             `${BASE_URL}/glossary/${slug}`,
      lastModified:    new Date(frontmatter.lastReviewed),
      priority:        0.7,
      changeFrequency: 'monthly' as const,
    })),
  ]

  return [...staticRoutes, ...dynamicRoutes]
}