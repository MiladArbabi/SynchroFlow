// components/seo/Schema.tsx
// Server-side only JSON-LD injector.
// NEVER import this inside a 'use client' component — schema must exist in static HTML.
// Usage: <Schema data={generateFAQSchema(faqs)} />

interface SchemaProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any> | null
}

export default function Schema({ data }: SchemaProps) {
  if (!data) return null
  return (
    <script
      type="application/ld+json"
      // Safe: data is internally generated, never from user input
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}