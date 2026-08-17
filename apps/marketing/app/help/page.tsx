import type { Metadata } from 'next'
import Link from 'next/link'
import HelpSearch from '@/components/help/HelpSearch'
import { getAllHelpArticles } from '@/lib/help'

// Public self-service support entry point for LaSyncro users.
export const metadata: Metadata = {
  title: 'Help Center — LaSyncro',
  description: 'Guides and troubleshooting for running your warehouse with LaSyncro.',
  alternates: { canonical: 'https://www.lasyncro.com/help' },
}

const categories = [
  ['Getting started', 'Set up LaSyncro and run your first warehouse workflows.'],
  ['Warehouse setup', 'Locations, zones, floor planning, and warehouse labels.'],
  ['Products & barcodes', 'Products, variants, SKUs, and barcode troubleshooting.'],
  ['Inventory', 'Understand stock, reservations, movements, and inventory differences.'],
  ['Receiving & stowing', 'Receive supplier stock and place it into warehouse locations.'],
  ['Orders & picking', 'Order Pool, release, batches, picking, and exceptions.'],
  ['Packing & shipping', 'Validate picked orders and complete fulfillment safely.'],
  ['Problem Center', 'Understand and resolve operational inventory problems.'],
  ['Returns', 'Receive, inspect, restock, quarantine, and resolve returns.'],
  ['Shopify', 'Connections, synchronization, locations, orders, and inventory updates.'],
  ['People & permissions', 'Owners, admins, operators, roles, and access.'],
  ['Troubleshooting', 'Diagnose common warehouse and synchronization problems.'],
] as const

const W = {
  maxWidth: '1200px',
  margin: '0 auto',
  padding: '0 5vw',
} as const

export default function HelpPage() {
  // Search is generated from the canonical Help corpus so article metadata
  // and user-facing search results cannot drift into separate data sources.
  const articles = getAllHelpArticles()

  const searchItems = articles.map((article) => ({
    title: article.frontmatter.title,
    description: article.frontmatter.description,
    category: article.frontmatter.category,
    href: `/help/${article.category}/${article.slug}`,
    keywords: article.frontmatter.keywords,
    searchAliases: article.frontmatter.searchAliases,
  }))

  return (
    <>
      <header style={{ ...W, padding: '88px 5vw 52px' }}>
        <div
          style={{
            color: '#FF6B2B',
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginBottom: 18,
          }}
        >
          LaSyncro Help Center
        </div>

        <h1
          style={{
            fontSize: 'clamp(36px, 5vw, 56px)',
            fontWeight: 400,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            color: '#0F0E0D',
            margin: '0 0 18px',
          }}
        >
          How can we help?
        </h1>

        <p
          style={{
            maxWidth: 620,
            margin: 0,
            fontSize: 17,
            fontWeight: 300,
            lineHeight: 1.65,
            color: '#6B7280',
          }}
        >
          Find setup guides, workflow instructions, inventory explanations, and
          troubleshooting steps for LaSyncro.
        </p>
      </header>

    <main style={{ ...W, padding: '0 5vw 96px' }}>
        <HelpSearch items={searchItems} />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
          }}
        >
          {categories.map(([title, description]) => (
            <div
              key={title}
              style={{
                padding: 24,
                border: '1px solid #E8E6E0',
                borderRadius: 12,
                background: '#FFFFFF',
              }}
            >
              <h2
                style={{
                  margin: '0 0 8px',
                  fontSize: 18,
                  fontWeight: 500,
                  color: '#0F0E0D',
                }}
              >
                {title}
              </h2>

              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  fontWeight: 300,
                  lineHeight: 1.6,
                  color: '#6B7280',
                }}
              >
                {description}
              </p>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 48,
            paddingTop: 32,
            borderTop: '1px solid #E8E6E0',
            fontSize: 14,
            color: '#6B7280',
          }}
        >
          Still need help?{' '}
          <Link href="mailto:support@lasyncro.com" style={{ color: '#FF6B2B' }}>
            Contact LaSyncro support
          </Link>
        </div>
      </main>
    </>
  )
}