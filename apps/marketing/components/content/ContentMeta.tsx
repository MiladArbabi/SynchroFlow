import type { ReactNode } from 'react'
import styles from './content.module.css'
import { cx } from './link'

export interface ContentMetaItem {
  label?: ReactNode
  value: ReactNode
}

export interface ContentMetaProps {
  items: ContentMetaItem[]
  className?: string
}

export function ContentMeta({ items, className }: ContentMetaProps) {
  return (
    <div className={cx(styles.meta, className)}>
      {items.map((item, index) => (
        <div key={index} className={styles.metaItem}>
          {index > 0 ? <span className={styles.metaDivider} aria-hidden="true" /> : null}
          {item.label ? <span className={styles.metaLabel}>{item.label}</span> : null}
          <span>{item.value}</span>
        </div>
      ))}
    </div>
  )
}
