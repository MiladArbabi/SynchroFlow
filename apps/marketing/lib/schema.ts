// lib/schema.ts
// Centralised schema generators for all JSON-LD structured data.
// Import these in page.tsx files and pass to <Schema> component.
// NEVER emit schema client-side — always server-side only.

export interface FAQItem {
  question: string
  answer: string
}

/** FAQPage schema — used on every article, comparison, and feature page */
export function generateFAQSchema(faqs: FAQItem[]) {
  if (!faqs?.length) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  }
}

/** Article schema — used on all blog and compare pages */
export function generateArticleSchema({
  title,
  description,
  url,
  datePublished,
  dateModified,
  image,
}: {
  title: string
  description: string
  url: string
  datePublished: string
  dateModified: string
  image?: string
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    url,
    datePublished,
    dateModified,
    ...(image ? { image } : {}),
    author: { '@id': 'https://www.lasyncro.com/#organization', },
    publisher: { '@id': 'https://www.lasyncro.com/#organization', },
  }
}

/** SoftwareApplication schema — used on /features and /industries pages */
export function generateSoftwareSchema({
  name,
  description,
  url,
}: {
  name: string
  description: string
  url: string
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name,
    description,
    url,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web, iOS, Android',
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'USD',
      lowPrice: '0',
      highPrice: '349',
    },
    publisher: { '@id': 'https://www.lasyncro.com/#organization', },
  }
}

/** BreadcrumbList schema — used on all non-homepage routes */
export function generateBreadcrumbSchema(
  crumbs: { name: string; url: string }[]
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  }
}

/** DefinedTerm schema — used on glossary pages for AEO citation.
 *  AI engines (Perplexity, ChatGPT, Gemini) use DefinedTerm to cite
 *  definitions directly. This is the primary AEO schema for glossary pages. */
export function generateDefinedTermSchema({
  name,
  description,
}: {
  name: string
  description: string
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'DefinedTerm',
    name,
    description,
    inDefinedTermSet: {
      '@type': 'DefinedTermSet',
      name: 'LaSyncro Warehouse Operations Glossary',
      url: 'https://www.lasyncro.com/glossary',
    },
  }
}