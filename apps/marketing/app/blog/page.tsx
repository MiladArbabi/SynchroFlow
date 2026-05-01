// app/blog/page.tsx
// Blog index — lists all published articles sorted by date descending.
// Add new articles to /content/blog/*.mdx — they appear here automatically.

import { getAllContent } from '@/lib/mdx'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Blog — LaSyncro',
  description: 'Guides, tips, and operational intelligence for Shopify merchants running their own warehouse.',
  alternates: { canonical: 'https://lasyncro.com/blog' },
}

export default function BlogIndex() {
  const articles = getAllContent('blog').sort(
    (a, b) => new Date(b.frontmatter.date).getTime() - new Date(a.frontmatter.date).getTime()
  )

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
        Blog
      </h1>
      <p className="text-gray-500 dark:text-gray-400 mb-12">
        Operational intelligence for Shopify merchants running their own warehouse.
      </p>

      {articles.length === 0 && (
        <p className="text-gray-400">No articles published yet.</p>
      )}

      <ul className="space-y-10">
        {articles.map((article) => (
          <li key={article.slug}>
            
              <a href={`/blog/${article.slug}`} className="group flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-orange-500">
                {article.frontmatter.tags?.[0]}
              </span>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-orange-500 transition-colors">
                {article.frontmatter.title}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {article.frontmatter.description}
              </p>
              <span className="text-xs text-gray-400">{article.frontmatter.date}</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  )
}