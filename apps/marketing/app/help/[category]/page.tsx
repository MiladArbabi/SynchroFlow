import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  getAllHelpArticles,
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
  const articles = getHelpArticlesByCategory(category)

  if (articles.length === 0) {
    notFound()
  }

  const label = articles[0].frontmatter.category

  return {
    title: `${label} — LaSyncro Help`,
    description: `Help articles and troubleshooting for ${label} in LaSyncro.`,
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
  const articles = getHelpArticlesByCategory(category)

  if (articles.length === 0) {
    notFound()
  }

  const label = articles[0].frontmatter.category

  return (
    <main
      style={{
        maxWidth: 880,
        margin: '0 auto',
        padding: '72px 5vw 96px',
      }}
    >
      <nav
        aria-label="Breadcrumb"
        style={{
          marginBottom: 28,
          fontSize: 12,
          color: '#6B7280',
        }}
      >
        <Link href="/help" style={{ color: '#6B7280' }}>
          Help Center
        </Link>
        {' › '}
        <span>{label}</span>
      </nav>

      <header
        style={{
          paddingBottom: 32,
          marginBottom: 32,
          borderBottom: '1px solid #E8E6E0',
        }}
      >
        <h1
          style={{
            margin: '0 0 12px',
            fontSize: 'clamp(34px, 5vw, 48px)',
            fontWeight: 400,
            color: '#0F0E0D',
          }}
        >
          {label}
        </h1>

        <p
          style={{
            margin: 0,
            fontSize: 17,
            fontWeight: 300,
            lineHeight: 1.6,
            color: '#6B7280',
          }}
        >
          Guides and troubleshooting for {label}.
        </p>
      </header>

      <div>
        {articles.map((article) => (
          <Link
            key={article.slug}
            href={`/help/${article.category}/${article.slug}`}
            style={{
              display: 'block',
              padding: '22px 0',
              borderBottom: '1px solid #E8E6E0',
              color: 'inherit',
              textDecoration: 'none',
            }}
          >
            <h2
              style={{
                margin: '0 0 6px',
                fontSize: 18,
                fontWeight: 500,
                color: '#0F0E0D',
              }}
            >
              {article.frontmatter.title}
            </h2>

            <p
              style={{
                margin: 0,
                fontSize: 14,
                lineHeight: 1.6,
                color: '#6B7280',
              }}
            >
              {article.frontmatter.description}
            </p>
          </Link>
        ))}
      </div>
    </main>
  )
}