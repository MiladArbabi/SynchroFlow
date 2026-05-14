// app/robots.ts
// Serves /robots.txt via Next.js MetadataRoute.
// All crawlers permitted. AI crawlers explicitly allowed for AEO.
// To block a specific bot, add: { userAgent: 'BotName', disallow: '/' }

import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/' },
      { userAgent: 'Googlebot', allow: '/' },
      { userAgent: 'Google-Extended', allow: '/' },
      { userAgent: 'GPTBot', allow: '/' },
      { userAgent: 'ClaudeBot', allow: '/' },
      { userAgent: 'PerplexityBot', allow: '/' },
      { userAgent: 'Amazonbot', allow: '/' },
      { userAgent: 'cohere-ai', allow: '/' },
    ],
    sitemap: 'https://www.lasyncro.com/sitemap.xml',
  }
}