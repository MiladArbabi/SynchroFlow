// app/compare/page.tsx
// Comparison hub — links to all competitor comparison pages.
// Builds topical authority around alternatives. Add new comparisons to /content/compare/*.mdx.

import { Metadata } from 'next'
import { getAllContent } from '@/lib/mdx'

export const metadata: Metadata = {
  title: 'LaSyncro vs Alternatives — Compare Shopify Operations Tools',
  description: 'See how LaSyncro compares to Cin7, Linnworks, Brightpearl and other Shopify operations tools. Built for SMB merchants who need power without enterprise complexity.',
  alternates: { canonical: 'https://lasyncro.com/compare' },
}

export default function CompareIndex() {
  const pages = getAllContent('compare').sort(
    (a, b) => new Date(b.frontmatter.date).getTime() - new Date(a.frontmatter.date).getTime()
  )

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
        LaSyncro vs Alternatives
      </h1>
      <p className="text-gray-500 dark:text-gray-400 mb-12">
        How LaSyncro compares to enterprise WMS and operations tools — built for Shopify merchants who need operational intelligence without the enterprise price tag.
      </p>

      {pages.length === 0 && (
        <p className="text-gray-400">Comparison pages coming soon.</p>
      )}

      <ul className="space-y-8">
        {pages.map((page) => (
          <li key={page.slug}>
            <a href={`/compare/${page.slug}`} className="group flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-orange-500 transition-colors">
                {page.frontmatter.title}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {page.frontmatter.description}
              </p>
            </a>
          </li>
        ))}
      </ul>
    </main>
  )
}