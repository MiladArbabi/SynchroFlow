import type { ElementType, ReactNode } from 'react'
import styles from './content.module.css'
import { ContentLink, cx } from './link'

export interface ContentCTAAction {
  href: string
  label: ReactNode
}

export interface ContentCTAProps {
  title: ReactNode
  body?: ReactNode
  eyebrow?: ReactNode
  action?: ContentCTAAction
  headingAs?: ElementType
  className?: string
}

export function ContentCTA({
  title,
  body,
  eyebrow,
  action,
  headingAs: Heading = 'h2',
  className,
}: ContentCTAProps) {
  return (
    <aside className={cx(styles.cta, className)}>
      {eyebrow ? <div className={styles.ctaEyebrow}>{eyebrow}</div> : null}
      <Heading className={styles.ctaTitle}>{title}</Heading>
      {body ? <div className={styles.ctaBody}>{body}</div> : null}
      {action ? (
        <div className={styles.ctaAction}>
          <ContentLink href={action.href} className={styles.ctaLink}>
            {action.label}
          </ContentLink>
        </div>
      ) : null}
    </aside>
  )
}
