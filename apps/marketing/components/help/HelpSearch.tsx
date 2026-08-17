'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

export interface HelpSearchItem {
  title: string
  description: string
  category: string
  href: string
  keywords: string[]
  searchAliases: string[]
}

export default function HelpSearch({
  items,
}: {
  items: HelpSearchItem[]
}) {
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) return []

    return items.filter((item) => {
      const searchableText = [
        item.title,
        item.description,
        item.category,
        ...item.keywords,
        ...item.searchAliases,
      ]
        .join(' ')
        .toLowerCase()

      return searchableText.includes(normalizedQuery)
    })
  }, [items, query])

  const hasQuery = query.trim().length > 0

  return (
    <section style={{ marginBottom: 48 }}>
      <label
        htmlFor="help-search"
        style={{
          display: 'block',
          marginBottom: 10,
          fontSize: 13,
          fontWeight: 500,
          color: '#3A3835',
        }}
      >
        Search Help
      </label>

      <input
        id="help-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Try “Shopify connection failed”"
        autoComplete="off"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '14px 16px',
          border: '1px solid #D8D5CF',
          borderRadius: 10,
          background: '#FFFFFF',
          color: '#0F0E0D',
          font: 'inherit',
          fontSize: 15,
          outline: 'none',
        }}
      />

      {hasQuery && (
        <div
          aria-live="polite"
          style={{
            marginTop: 16,
            border: '1px solid #E8E6E0',
            borderRadius: 10,
            background: '#FFFFFF',
            overflow: 'hidden',
          }}
        >
          {results.length > 0 ? (
            results.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'block',
                  padding: '16px 18px',
                  borderBottom: '1px solid #F0EEEA',
                  color: 'inherit',
                  textDecoration: 'none',
                }}
              >
                <div
                  style={{
                    marginBottom: 4,
                    fontSize: 11,
                    fontWeight: 500,
                    color: '#FF6B2B',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  {item.category}
                </div>

                <div
                  style={{
                    marginBottom: 4,
                    fontSize: 15,
                    fontWeight: 500,
                    color: '#0F0E0D',
                  }}
                >
                  {item.title}
                </div>

                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: '#6B7280',
                  }}
                >
                  {item.description}
                </div>
              </Link>
            ))
          ) : (
            <div
              style={{
                padding: 18,
                fontSize: 14,
                color: '#6B7280',
              }}
            >
              No help articles found for “{query.trim()}”.
            </div>
          )}
        </div>
      )}
    </section>
  )
}