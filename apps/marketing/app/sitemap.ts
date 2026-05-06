// app/sitemap.ts
// Auto-generated sitemap — reads all MDX slugs at build time.
// No manual updates needed — add a .mdx file to /content/* and it appears automatically.
// Submit https://lasyncro.com/sitemap.xml to GSC after each deploy.

import { MetadataRoute } from 'next'
import { getAllSlugs } from '@/lib/mdx'

const BASE_URL = 'https://www.lasyncro.com'

export default function sitemap(): MetadataRoute.Sitemap {
  const blogSlugs = getAllSlugs('blog')
  const compareSlugs = getAllSlugs('compare')
  const industrySlugs = getAllSlugs('industries')
  const featureSlugs = getAllSlugs('features')

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: new Date(), priority: 1.0, changeFrequency: 'weekly' },
    { url: `${BASE_URL}/about`, lastModified: new Date(), priority: 0.8, changeFrequency: 'monthly' },
    { url: `${BASE_URL}/blog`, lastModified: new Date(), priority: 0.9, changeFrequency: 'daily' },
    { url: `${BASE_URL}/compare`, lastModified: new Date(), priority: 0.8, changeFrequency: 'weekly' },
    { url: `${BASE_URL}/checklist`, lastModified: new Date(), priority: 0.7, changeFrequency: 'monthly' as const },
  ]

  const dynamicRoutes: MetadataRoute.Sitemap = [
    ...blogSlugs.map((slug) => ({
      url: `${BASE_URL}/blog/${slug}`,
      lastModified: new Date(),
      priority: 0.8,
      changeFrequency: 'weekly' as const,
    })),
    ...compareSlugs.map((slug) => ({
      url: `${BASE_URL}/compare/${slug}`,
      lastModified: new Date(),
      priority: 0.8,
      changeFrequency: 'monthly' as const,
    })),
    ...industrySlugs.map((slug) => ({
      url: `${BASE_URL}/industries/${slug}`,
      lastModified: new Date(),
      priority: 0.7,
      changeFrequency: 'monthly' as const,
    })),
    ...featureSlugs.map((slug) => ({
      url: `${BASE_URL}/features/${slug}`,
      lastModified: new Date(),
      priority: 0.7,
      changeFrequency: 'monthly' as const,
    })),
  ]

  return [...staticRoutes, ...dynamicRoutes]
}