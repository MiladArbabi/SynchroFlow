// components/article/InternalLinks.tsx
// Related article links at the bottom of every article.
// Every article should link to 3+ related pages.

interface LinkItem {
  href: string
  title: string
  description?: string
}

interface InternalLinksProps {
  links: LinkItem[]
}

export default function InternalLinks({ links }: InternalLinksProps) {
  if (!links?.length) return null
  return (
    <section aria-label="Related articles" style={{ marginTop: '48px', borderTop: '1px solid var(--rule)', paddingTop: '32px' }}>
      <h3 style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ink-3)', marginBottom: '16px' }}>
        Related
      </h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {links.map((link, i) => (
          <li key={i}>
            <a href={link.href} style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '14px', fontWeight: 500, color: '#FF6B2B' }}>
                {link.title}
              </span>
              {link.description && (
                <span style={{ fontSize: '13px', color: 'var(--ink-3)' }}>
                  {link.description}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}