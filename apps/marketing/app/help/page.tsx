import type { Metadata } from 'next'
import HelpSearch from '@/components/help/HelpSearch'
import {
  ContentCard,
  ContentCTA,
  ContentHero,
  ContentMeta,
  ContentShell,
} from '@/components/content'
import { getAllHelpArticles, getHelpCategoriesWithCounts } from '@/lib/help'

// Public self-service support entry point for LaSyncro users.
export const metadata: Metadata = {
  title: 'Help Center — LaSyncro',
  description: 'Guides and troubleshooting for running your warehouse with LaSyncro.',
  alternates: { canonical: 'https://www.lasyncro.com/help' },
}

export default function HelpPage() {
  // Search is generated from the canonical Help corpus so article metadata
  // and user-facing search results cannot drift into separate data sources.
  const articles = getAllHelpArticles()
  const categories = getHelpCategoriesWithCounts()

  const searchItems = articles.map((article) => ({
    title: article.frontmatter.title,
    description: article.frontmatter.description,
    category: article.frontmatter.category,
    href: `/help/${article.category}/${article.slug}`,
    keywords: article.frontmatter.keywords,
    searchAliases: article.frontmatter.searchAliases,
  }))

  return (
    <ContentShell as="main" width="wide" style={{ paddingBottom: 96 }}>
      <ContentHero
        eyebrow="LaSyncro Help Center"
        title="How can we help?"
        description="Find setup guides, workflow instructions, inventory explanations, and troubleshooting steps for LaSyncro."
      />

      <HelpSearch items={searchItems} />

      <section
        aria-label="Help categories"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 16,
        }}
      >
        {categories.map((category) => (
          <ContentCard
            key={category.slug}
            href={`/help/${category.slug}`}
            headingAs="h2"
            title={category.label}
            description={category.description}
            metadata={
              <ContentMeta
                items={[{
                  value: `${category.articleCount} ${
                    category.articleCount === 1 ? 'article' : 'articles'
                  }`,
                }]}
              />
            }
            action={
              <span style={{ color: 'var(--accent)', fontSize: 14, fontWeight: 500 }}>
                View articles -&gt;
              </span>
            }
          />
          ))}
      </section>

      <div style={{ marginTop: 48 }}>
        <ContentCTA
          title="Still need help?"
          body="Contact LaSyncro support if you cannot find the workflow or troubleshooting step you need."
          action={{ href: 'mailto:contact@lasyncro.com', label: 'Contact LaSyncro support' }}
        />
      </div>
    </ContentShell>
  )
}
