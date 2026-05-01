// components/article/ArticleLayout.tsx
// Wraps all article, compare, and industry pages.
// Composes QuickAnswer, FAQ, InternalLinks, and WaitlistCTA in the correct order.
// Children = MDX rendered content (the body between QuickAnswer and FAQ).

import { Frontmatter } from '@/lib/mdx'
import FAQ from './FAQ'
import InternalLinks from './InternalLinks'
import WaitlistCTA from './WaitlistCTA'

interface ArticleLayoutProps {
  frontmatter: Frontmatter
  children: React.ReactNode
  relatedLinks?: { href: string; title: string; description?: string }[]
}

export default function ArticleLayout({
  frontmatter,
  children,
  relatedLinks = [],
}: ArticleLayoutProps) {
  return (
    <article className="mx-auto max-w-2xl px-4 py-16">
      {/* Article header */}
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-orange-500 mb-3">
          {frontmatter.tags?.[0]}
        </p>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white leading-tight mb-4">
          {frontmatter.title}
        </h1>
        <p className="text-base text-gray-500 dark:text-gray-400">
          {frontmatter.description}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
          {frontmatter.date}
          {frontmatter.lastReviewed !== frontmatter.date &&
            ` · Updated ${frontmatter.lastReviewed}`}
        </p>
      </header>

      {/* MDX body — QuickAnswer is embedded inside MDX as a component */}
      <div className="prose prose-gray dark:prose-invert max-w-none">
        {children}
      </div>

      {/* Mid-article CTA — rendered after body, before FAQ */}
      <WaitlistCTA variant="inline" text={frontmatter.cta_text} />

      {/* FAQ section — driven by frontmatter faq[] */}
      <FAQ items={frontmatter.faq} />

      {/* End-of-article CTA */}
      <WaitlistCTA variant="full" />

      {/* Internal links */}
      <InternalLinks links={relatedLinks} />
    </article>
  )
}