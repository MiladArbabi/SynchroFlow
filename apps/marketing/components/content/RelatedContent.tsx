import type { ReactNode } from 'react'
import styles from './content.module.css'
import { ContentLink, cx } from './link'

export interface RelatedContentItem {
  href: string
  title: ReactNode
  description?: ReactNode
}

export interface RelatedContentProps {
  items: RelatedContentItem[]
  title?: ReactNode
  className?: string
}

export function RelatedContent({
  items,
  title = 'Related',
  className,
}: RelatedContentProps) {
  if (items.length === 0) return null

  return (
    <section className={cx(styles.related, className)}>
      <h2 className={styles.relatedHeading}>{title}</h2>
      <div className={styles.relatedList}>
        {items.map((item) => (
          <ContentLink key={String(item.href)} href={item.href} className={styles.relatedItem}>
            <h3 className={styles.relatedTitle}>{item.title}</h3>
            {item.description ? <p className={styles.relatedDescription}>{item.description}</p> : null}
          </ContentLink>
        ))}
      </div>
    </section>
  )
}
