import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MDXRemote } from 'next-mdx-remote/rsc'
import remarkGfm from 'remark-gfm'
import {
  getAllHelpParams,
  getHelpArticle,
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

const components = {
  h2: ({ children }: { children: React.ReactNode }) => (
    <h2
      style={{
        fontSize: 28,
        fontWeight: 400,
        lineHeight: 1.25,
        color: '#0F0E0D',
        margin: '40px 0 14px',
      }}
    >
      {children}
    </h2>
  ),

  h3: ({ children }: { children: React.ReactNode }) => (
    <h3
      style={{
        fontSize: 18,
        fontWeight: 500,
        lineHeight: 1.3,
        color: '#0F0E0D',
        margin: '28px 0 10px',
      }}
    >
      {children}
    </h3>
  ),

  p: ({ children }: { children: React.ReactNode }) => (
    <p
      style={{
        fontSize: 16,
        fontWeight: 300,
        lineHeight: 1.75,
        color: '#3A3835',
        margin: '0 0 20px',
      }}
    >
      {children}
    </p>
  ),

  ul: ({ children }: { children: React.ReactNode }) => (
    <ul style={{ paddingLeft: 24, margin: '0 0 20px' }}>{children}</ul>
  ),

  ol: ({ children }: { children: React.ReactNode }) => (
    <ol style={{ paddingLeft: 24, margin: '0 0 20px' }}>{children}</ol>
  ),

  li: ({ children }: { children: React.ReactNode }) => (
    <li
      style={{
        fontSize: 16,
        fontWeight: 300,
        lineHeight: 1.7,
        color: '#3A3835',
        marginBottom: 6,
      }}
    >
      {children}
    </li>
  ),

  strong: ({ children }: { children: React.ReactNode }) => (
    <strong style={{ fontWeight: 500, color: '#0F0E0D' }}>
      {children}
    </strong>
  ),
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ category: string; slug: string }>
}) {
  const { category, slug } = await params
  const { frontmatter, content } = loadArticle(category, slug)

  return (
    <main
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '72px 5vw 96px',
      }}
    >
      <nav
        aria-label="Breadcrumb"
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          marginBottom: 28,
          fontSize: 12,
          color: '#6B7280',
        }}
      >
        <Link href="/help" style={{ color: '#6B7280' }}>
          Help Center
        </Link>

        <span>›</span>

        <span>{frontmatter.category}</span>
      </nav>

      <header
        style={{
          paddingBottom: 32,
          marginBottom: 32,
          borderBottom: '1px solid #E8E6E0',
        }}
      >
        <div
          style={{
            color: '#FF6B2B',
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginBottom: 16,
          }}
        >
          {frontmatter.category}
        </div>

        <h1
          style={{
            fontSize: 'clamp(34px, 5vw, 48px)',
            fontWeight: 400,
            lineHeight: 1.15,
            letterSpacing: '-0.02em',
            color: '#0F0E0D',
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
            color: '#6B7280',
            margin: 0,
          }}
        >
          {frontmatter.description}
        </p>
      </header>

      <article>
        <MDXRemote
          source={content}
          components={components}
          options={{
            mdxOptions: {
              remarkPlugins: [remarkGfm],
            },
          }}
        />
      </article>

      <footer
        style={{
          marginTop: 48,
          paddingTop: 28,
          borderTop: '1px solid #E8E6E0',
          fontSize: 14,
          color: '#6B7280',
        }}
      >
        Still stuck?{' '}
        <Link
          href="mailto:support@lasyncro.com"
          style={{ color: '#FF6B2B' }}
        >
          Contact LaSyncro support
        </Link>
      </footer>
    </main>
  )
}