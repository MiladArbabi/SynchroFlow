import type { ReactNode } from 'react'
import styles from './content.module.css'
import { ContentLink, cx } from './link'

export interface ContentBreadcrumbItem {
  label: ReactNode
  href?: string
}

export interface ContentBreadcrumbsProps {
  items: ContentBreadcrumbItem[]
  ariaLabel?: string
  className?: string
}

export function ContentBreadcrumbs({
  items,
  ariaLabel = 'Breadcrumbs',
  className,
}: ContentBreadcrumbsProps) {
  return (
    <nav aria-label={ariaLabel} className={cx(styles.breadcrumbs, className)}>
      <ol className={styles.breadcrumbsList}>
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          return (
            <li key={index} className={styles.breadcrumbItem}>
              {item.href && !isLast ? (
                <ContentLink href={item.href} className={styles.breadcrumbLink}>
                  {item.label}
                </ContentLink>
              ) : (
                <span className={styles.breadcrumbCurrent} aria-current={isLast ? 'page' : undefined}>
                  {item.label}
                </span>
              )}
              {!isLast ? <span className={styles.breadcrumbSeparator} aria-hidden="true">/</span> : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
