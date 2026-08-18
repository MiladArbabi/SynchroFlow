import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MDXRemote } from 'next-mdx-remote/rsc'
import remarkGfm from 'remark-gfm'
import {
  ContentArticleShell,
  ContentBreadcrumbs,
  ContentCTA,
  ContentMeta,
  RelatedContent,
  contentMdxComponents,
} from '@/components/content'
import {
  getAllHelpParams,
  getHelpArticle,
  getHelpCategory,
  resolveRelatedHelpArticles,
  type HelpArticle,
} from '@/lib/help'

function loadArticle(category: string, slug: string): HelpArticle {
  try {
    return getHelpArticle(category, slug)
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Help article not found:')
    ) {
      notFound()
    }

    throw error
  }
}

function formatReviewedDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]

  return `${Number(day)} ${monthNames[Number(month) - 1]} ${year}`
}

function formatAudience(audience: string[]): string {
  if (audience.length <= 2) return audience.join(' and ')

  return `${audience.slice(0, -1).join(', ')}, and ${audience[audience.length - 1]}`
}

export function generateStaticParams() {
  return getAllHelpParams()
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; slug: string }>
}): Promise<Metadata> {
  const { category, slug } = await params
  const { frontmatter } = loadArticle(category, slug)

  return {
    title: `${frontmatter.title} — LaSyncro Help`,
    description: frontmatter.description,
    alternates: {
      canonical: `https://www.lasyncro.com/help/${category}/${slug}`,
    },
  }
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ category: string; slug: string }>
}) {
  const { category, slug } = await params
  const article = loadArticle(category, slug)
  const { frontmatter, content } = article
  const categoryMeta = getHelpCategory(category)

  if (!categoryMeta) {
    notFound()
  }

  const relatedArticles = resolveRelatedHelpArticles(article)

  return (
    <ContentArticleShell
      breadcrumbs={
        <ContentBreadcrumbs
          items={[
            { label: 'Help Center', href: '/help' },
            { label: categoryMeta.label, href: `/help/${category}` },
            { label: frontmatter.title },
          ]}
        />
      }
      header={
        <>
          <div
            style={{
              color: 'var(--accent)',
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: 'var(--ls-eyebrow)',
              textTransform: 'uppercase',
              marginBottom: 16,
            }}
          >
            {categoryMeta.label}
          </div>

          <h1
            style={{
              fontSize: 'clamp(34px, 5vw, 48px)',
              fontWeight: 400,
              lineHeight: 1.15,
              letterSpacing: 'var(--ls-tight)',
              color: 'var(--ink)',
              margin: '0 0 16px',
            }}
          >
            {frontmatter.title}
          </h1>

          <p
            style={{
              fontSize: 18,
              fontWeight: 300,
              lineHeight: 1.6,
              color: 'var(--ink-3)',
              margin: '0 0 22px',
            }}
          >
            {frontmatter.description}
          </p>

          <ContentMeta
            items={[
              { label: 'Audience', value: formatAudience(frontmatter.audience) },
              { label: 'Last reviewed', value: formatReviewedDate(frontmatter.lastReviewed) },
            ]}
          />
        </>
      }
      related={
        relatedArticles.length > 0 ? (
          <RelatedContent title="Related help articles" items={relatedArticles} />
        ) : undefined
      }
      support={
        <ContentCTA
          title="Still stuck?"
          body="Contact LaSyncro support if this article does not answer your question."
          action={{ href: 'mailto:contact@lasyncro.com', label: 'Contact LaSyncro support' }}
        />
      }
    >
        <MDXRemote
          source={content}
          components={contentMdxComponents}
          options={{
            mdxOptions: {
              remarkPlugins: [remarkGfm],
            },
          }}
        />
    </ContentArticleShell>
  )
}
