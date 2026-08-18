import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import {
  ContentBreadcrumbs,
  ContentCTA,
  ContentHero,
  ContentMeta,
  ContentRow,
  ContentShell,
} from '@/components/content'
import {
  getAllHelpArticles,
  getHelpCategory,
  getHelpArticlesByCategory,
} from '@/lib/help'

export function generateStaticParams() {
  const categories = new Set(
    getAllHelpArticles().map((article) => article.category)
  )

  return [...categories].map((category) => ({ category }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>
}): Promise<Metadata> {
  const { category } = await params
  const categoryMeta = getHelpCategory(category)
  const articles = getHelpArticlesByCategory(category)

  if (!categoryMeta || articles.length === 0) {
    notFound()
  }

  return {
    title: `${categoryMeta.label} — LaSyncro Help`,
    description: categoryMeta.description,
    alternates: {
      canonical: `https://www.lasyncro.com/help/${category}`,
    },
  }
}

export default async function HelpCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>
}) {
  const { category } = await params
  const categoryMeta = getHelpCategory(category)
  const articles = getHelpArticlesByCategory(category)

  if (!categoryMeta || articles.length === 0) {
    notFound()
  }

  return (
    <ContentShell as="main" width="medium" style={{ paddingTop: 72, paddingBottom: 96 }}>
      <ContentBreadcrumbs
        items={[
          { label: 'Help Center', href: '/help' },
          { label: categoryMeta.label },
        ]}
      />

      <ContentHero
        eyebrow="LaSyncro Help"
        title={categoryMeta.label}
        description={categoryMeta.description}
      />

      <ContentMeta
        items={[{
          value: `${articles.length} ${articles.length === 1 ? 'article' : 'articles'}`,
        }]}
      />

      <section aria-label={`${categoryMeta.label} articles`} style={{ marginTop: 28 }}>
        {articles.map((article) => (
          <ContentRow
            key={article.slug}
            href={`/help/${article.category}/${article.slug}`}
            headingAs="h2"
            title={article.frontmatter.title}
            description={article.frontmatter.description}
            trailing={<span aria-hidden="true">-&gt;</span>}
          />
        ))}
      </section>

      <div style={{ marginTop: 48 }}>
        <ContentCTA
          title="Still need help?"
          body="Contact LaSyncro support if this category does not answer your question."
          action={{ href: 'mailto:contact@lasyncro.com', label: 'Contact LaSyncro support' }}
        />
      </div>
    </ContentShell>
  )
}
