// components/article/InternalLinks.tsx
// Renders related article links at the bottom of every article.
// Every article should link to 3+ related pages — critical for internal link graph.
// Always include at least one comparison page and one feature page per article.

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
    <section aria-label="Related articles" className="mt-12 border-t border-gray-200 dark:border-gray-700 pt-8">
      <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-4">
        Related
      </h3>
      <ul className="space-y-3">
        {links.map((link, i) => (
          <li key={i}>
            
              <a href={link.href} className="group flex flex-col gap-0.5 text-sm">
              <span className="font-medium text-orange-500 group-hover:text-orange-600 transition-colors">
                {link.title}
              </span>
              {link.description && (
                <span className="text-gray-500 dark:text-gray-400">
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