// app/blog/[slug]/page.tsx
// Dynamic route for all blog articles.
// Generates static pages at build time from /content/blog/*.mdx.
// Schema: Article + FAQPage + BreadcrumbList injected server-side.

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { MDXRemote } from 'next-mdx-remote/rsc'
import { getAllSlugs, getContentBySlug } from '@/lib/mdx'
import { generateArticleSchema, generateFAQSchema, generateBreadcrumbSchema } from '@/lib/schema'
import Schema from '@/components/seo/Schema'
import {
  ContentArticleShell,
  ContentBreadcrumbs,
  ContentMeta,
  createContentMdxComponents,
} from '@/components/content'
import BlogArticleTracker from '@/components/blog/BlogArticleTracker'
import ArticleCTA from '@/components/article/ArticleCTA'
import FAQ from '@/components/article/FAQ'
import InternalLinks from '@/components/article/InternalLinks'
import ArticleImage from '@/components/article/ArticleImage'
import ArticleAnimation from '@/components/article/ArticleAnimation'
import HeroVisual from '@/components/article/HeroVisual'
import ProductVisual from '@/components/article/ProductVisual'
import remarkGfm from 'remark-gfm'
import styles from '../blog.module.css'

const components = {
  ...createContentMdxComponents(),
  QuickAnswer: BlogQuickAnswer,
  ArticleImage,
  HeroVisual,
  NumberedH3: BlogNumberedH3,
  Checklist: BlogChecklist,
  ArticleAnimation,
  ProductVisual,
}

function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function BlogArticleHeader({
  title,
  titleAccent,
  description,
  date,
  lastReviewed,
  tags,
  readTime,
}: {
  title: string
  titleAccent?: string
  description: string
  date: string
  lastReviewed: string
  tags: string[]
  readTime: number
}) {
  return (
    <>
      <div style={{
        marginBottom: 28,
        color: 'var(--accent)',
        fontFamily: 'var(--sans)',
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: 'var(--ls-eyebrow)',
        lineHeight: 1.2,
        textTransform: 'uppercase',
      }}>
        {tags?.[0] ?? 'Blog'}
      </div>
      <h1 style={{
        margin: '0 0 30px',
        color: 'var(--ink)',
        fontFamily: 'var(--sans)',
        fontSize: 'clamp(36px, 5vw, 56px)',
        fontWeight: 400,
        letterSpacing: 'var(--ls-tight)',
        lineHeight: 1.2,
      }}>
        {titleAccent ? (
          <>
            {title}{' '}
            <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>{titleAccent}</em>
          </>
        ) : title}
      </h1>
      <p style={{
        margin: '0 0 28px',
        color: 'var(--ink-2)',
        fontFamily: 'var(--sans)',
        fontSize: 19,
        fontWeight: 300,
        lineHeight: 1.55,
      }}>
        {description}
      </p>
      <ContentMeta
        items={[
          { label: 'By', value: 'LaSyncro' },
          { value: formatLongDate(date) },
          ...(lastReviewed !== date
            ? [{ value: `Last reviewed ${formatLongDate(lastReviewed)}` }]
            : []),
          { value: `${readTime} min read` },
          ...(tags?.length ? [{ value: tags.join(' · ') }] : []),
        ]}
      />
    </>
  )
}

function LegacyReadableSection({ children }: { children: ReactNode }) {
  return (
    <div style={{
      border: '1px solid var(--rule)',
      borderRadius: 'var(--r-lg)',
      background: 'color-mix(in srgb, var(--ink) 96%, var(--bg))',
      padding: '32px 36px',
      colorScheme: 'light',
    }}>
      {children}
    </div>
  )
}

function BlogQuickAnswer({ children, title = 'Quick Answer' }: { children: ReactNode; title?: string }) {
  return (
    <aside
      aria-label="Quick answer"
      style={{
        margin: '36px auto 0',
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--accent-border)',
        background: 'var(--accent-ghost)',
        padding: '20px 24px',
      }}
    >
      <p style={{
        margin: '0 0 8px',
        color: 'var(--accent)',
        fontFamily: 'var(--sans)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 'var(--ls-micro)',
        lineHeight: 1.2,
        textTransform: 'uppercase',
      }}>
        {title}
      </p>
      <div style={{ color: 'var(--ink-2)' }}>
        {children}
      </div>
    </aside>
  )
}

function BlogNumberedH3({ n, title }: { n: string; title: string }) {
  return (
    <h3 style={{
      display: 'flex',
      alignItems: 'baseline',
      gap: 12,
      margin: '32px 0 14px',
      color: 'var(--ink)',
      fontFamily: 'var(--sans)',
      fontSize: 18,
      fontWeight: 500,
      lineHeight: 1.3,
    }}>
      <span style={{
        flexShrink: 0,
        color: 'var(--accent)',
        fontFamily: 'var(--sans)',
        fontSize: 15,
        fontStyle: 'italic',
        fontWeight: 400,
        lineHeight: 1,
      }}>
        {n}.
      </span>
      <span>{title}</span>
    </h3>
  )
}

function BlogChecklist({ items }: { items: string | string[] }) {
  const itemList = Array.isArray(items) ? items : items.split('|')

  return (
    <div style={{
      margin: '8px 0 22px',
      display: 'grid',
      gap: 1,
      border: '1px solid var(--rule)',
      borderRadius: 'var(--r-md)',
      background: 'var(--rule)',
      overflow: 'hidden',
    }}>
      {itemList.map((item, i) => (
        <div key={i} style={{
          display: 'grid',
          gridTemplateColumns: '24px 1fr',
          gap: 12,
          alignItems: 'start',
          background: 'var(--surface)',
          padding: '14px 18px',
          color: 'var(--ink-2)',
          fontFamily: 'var(--sans)',
          fontSize: 14,
          fontWeight: 400,
          lineHeight: 1.55,
        }}>
          <span style={{ color: 'var(--accent)', fontWeight: 500 }}>
            {String(i + 1).padStart(2, '0')}
          </span>
          <span>{item}</span>
        </div>
      ))}
    </div>
  )
}

export async function generateStaticParams() {
  return getAllSlugs('blog').map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const { frontmatter } = getContentBySlug('blog', slug)
  const fallbackImage = 'https://www.lasyncro.com/og_image_lightmode.png'
  const articleImagePath = frontmatter.ogImage ?? frontmatter.image
  const articleImage = articleImagePath ? `https://www.lasyncro.com/${articleImagePath}` : fallbackImage
  const articleImageAlt = frontmatter.imageAlt ?? 'LaSyncro — Operational intelligence for Shopify merchants'

  return {
    title: `${frontmatter.title} — LaSyncro`,
    description: frontmatter.description,
    alternates: { canonical: `https://www.lasyncro.com/blog/${slug}` },
    openGraph: {
      title: frontmatter.title,
      description: frontmatter.description,
      url: `https://www.lasyncro.com/blog/${slug}`,
      type: 'article',
      images: [
        {
          url: articleImage,
          width: 1200,
          height: 630,
          alt: articleImageAlt,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: frontmatter.title,
      description: frontmatter.description,
      images: [articleImage],
    },
  }
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { frontmatter, content } = getContentBySlug('blog', slug)
  const url = `https://www.lasyncro.com/blog/${slug}`
  const wordCount = content?.split(/\s+/).length ?? 0
  const readTime = Math.max(1, Math.ceil(wordCount / 200))

  return (
    <>
      <Schema data={generateArticleSchema({
        title: frontmatter.title,
        description: frontmatter.description,
        url,
        datePublished: frontmatter.date,
        dateModified: frontmatter.lastReviewed,
        image: frontmatter.ogImage || frontmatter.image ? `https://www.lasyncro.com/${frontmatter.ogImage ?? frontmatter.image}` : undefined,
      })} />
      <Schema data={generateFAQSchema(frontmatter.faq)} />
      <Schema data={generateBreadcrumbSchema([
        { name: 'Home', url: 'https://www.lasyncro.com' },
        { name: 'Blog', url: 'https://www.lasyncro.com/blog' },
        { name: frontmatter.title, url },
      ])} />

      <ContentArticleShell
        className={styles.blogArticle}
        breadcrumbs={
          <ContentBreadcrumbs
            items={[
              { label: 'Blog', href: '/blog' },
              { label: frontmatter.tags?.[0] ?? 'Article' },
              { label: frontmatter.title },
            ]}
          />
        }
        header={
          <BlogArticleHeader
            title={frontmatter.title}
            titleAccent={frontmatter.titleAccent}
            description={frontmatter.description}
            date={frontmatter.date}
            lastReviewed={frontmatter.lastReviewed}
            tags={frontmatter.tags}
            readTime={readTime}
          />
        }
        footer={
          <>
            <LegacyReadableSection>
              <FAQ items={frontmatter.faq} />
            </LegacyReadableSection>
            <ArticleCTA variant="full" href={frontmatter.cta_url} label={frontmatter.cta_label} />
          </>
        }
        related={
          <LegacyReadableSection>
            <InternalLinks links={frontmatter.relatedLinks ?? []} />
          </LegacyReadableSection>
        }
      >
        <MDXRemote source={content} components={components} options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }} />
        <ArticleCTA variant="inline" text={frontmatter.cta_text} href={frontmatter.cta_url} label={frontmatter.cta_label} />
        <BlogArticleTracker
          slug={slug}
          category={frontmatter.tags?.[0] ?? 'general'}
          estimatedReadMin={readTime}
        />
      </ContentArticleShell>
      <script src="/reveal.js" async />
    </>
  )
}
