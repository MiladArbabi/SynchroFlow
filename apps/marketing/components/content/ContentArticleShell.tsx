import type { ReactNode } from 'react'
import { ContentProse } from './ContentProse'
import { ContentShell } from './ContentShell'
import styles from './content.module.css'
import { cx } from './link'

export interface ContentArticleShellProps {
  children: ReactNode
  breadcrumbs?: ReactNode
  header?: ReactNode
  footer?: ReactNode
  related?: ReactNode
  support?: ReactNode
  className?: string
}

export function ContentArticleShell({
  children,
  breadcrumbs,
  header,
  footer,
  related,
  support,
  className,
}: ContentArticleShellProps) {
  return (
    <ContentShell width="article" className={cx(styles.articleShell, className)}>
      {breadcrumbs}
      {header ? <header className={styles.articleHeader}>{header}</header> : null}
      <ContentProse as="article" className={styles.articleBody}>
        {children}
      </ContentProse>
      {footer ? <footer className={styles.articleFooter}>{footer}</footer> : null}
      {related ? <aside className={styles.articleRelated}>{related}</aside> : null}
      {support ? <aside className={styles.articleSupport}>{support}</aside> : null}
    </ContentShell>
  )
}
